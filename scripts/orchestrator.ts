#!/usr/bin/env -S npx tsx
/**
 * orchestrator.ts — the deterministic state machine for a /tulpkit:make run.
 *
 * Drives the staged run and gates the exit. The orchestrator (main session) calls it.
 *
 * VALIDATION POLICY (decided early, adapts to the project):
 *   - `detect`  inspects the repo and suggests a test command + test-first vs adapt.
 *   - `validation --mode tdd|adapt|manual [--cmd "..."] [--reason "..."]` records it.
 *
 * EXIT GATES (all enforced at signoff):
 *   1. Executable validation: a REAL green run (CLI runs it, checks exit 0) — or recorded `manual`.
 *   2. Test integrity: the tester's locked tests were not weakened/deleted by the implementer.
 *   3. Spec-conformance attestation: sign-off must attest the spec is met, not merely that tests pass.
 *      Hardened: if the spec was frozen (`spec-lock`), the locked acceptance criteria must be intact.
 *   4. Auditable sign-off: checklist (>= 4 non-empty items) and zero open review issues.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, ".claude", "orchestrator");
const STATE_FILE = path.join(STATE_DIR, "run-state.json");

const MIN_CHECKLIST_ITEMS = 4;
const TEST_TIMEOUT_MS = 10 * 60 * 1000;

type Phase = { id: string; name: string; status: "pending" | "active" | "done" };
type Validation = {
  mode: "tdd" | "adapt" | "manual" | null;
  command: string | null;
  reason: string | null;
  decided_by: string | null;
  at: string | null;
  manual_despite_tests: string | null; // set only when manual is forced past a detectable test command
};
type ReviewIteration = { n: number; issues_found: number; resolved: boolean; at: string; critics?: number };
type TestRun = { cmd: string; passed: boolean; code: number; at: string; summary: string };
type SignOff = { approved_by: string; at: string; checklist: Record<string, string> };
type TestLock = { at: string; by: string; files: Record<string, string> };
type SpecLock = { at: string; by: string; source: "task" | "skill"; files: Record<string, string> };

type RunState = {
  task: string;
  tier: "quick" | "full";
  routing?: { mode: "auto" | "explicit"; reason: string | null; by: string | null };
  started_at: string;
  status: "in_progress" | "complete" | "aborted";
  phases: Phase[];
  validation: Validation;
  test_runs: TestRun[];
  review_iterations: ReviewIteration[];
  test_lock: TestLock | null;
  spec_lock: SpecLock | null;
  sign_off: SignOff | null;
  block_count: number;
};

const DEFAULT_PHASES: Phase[] = [
  { id: "P0", name: "Assemble the brief: specs-as-skills + conventions + matching LEARNINGS + acceptance criteria", status: "pending" },
  { id: "P1", name: "Research + architecture; decide the validation policy", status: "pending" },
  { id: "P2", name: "Build with validation (tester writes & locks tests; implementer makes them pass)", status: "pending" },
  { id: "P3", name: "Integration + apply across the codebase", status: "pending" },
  { id: "P4", name: "Review loop until sign-off (reviewer ≠ implementer; Codex if available)", status: "pending" },
];

// QUICK tier: drop the research/architecture (P1) and standalone integration (P3) ceremony for
// small, single-file, tightly-coupled changes. Only the THREE gate-critical roles run — tester
// (authors & locks), implementer (passes), reviewer (≠ implementer). The four sign-off gates are
// byte-for-byte identical to full tier: tier changes staffing, never the floor.
const QUICK_PHASES: Phase[] = [
  { id: "P0", name: "Assemble the brief: spec + conventions + matching LEARNINGS + acceptance criteria; decide validation policy", status: "pending" },
  { id: "P2", name: "Build with validation (tester writes & locks tests; implementer makes them pass) + integrate", status: "pending" },
  { id: "P4", name: "Review loop until sign-off (reviewer ≠ implementer; Codex if available)", status: "pending" },
];

function read(): RunState | null {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as RunState; } catch { return null; }
}
function write(s: RunState): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + "\n");
}
function now(): string { return new Date().toISOString(); }

function parseArgs(argv: string[]): { flags: Record<string, string>; checks: Record<string, string> } {
  const flags: Record<string, string> = {};
  const checks: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    if (key === "check") {
      const eq = val.indexOf("=");
      if (eq > 0) checks[val.slice(0, eq)] = val.slice(eq + 1).replace(/^["']|["']$/g, "");
    } else flags[key] = val;
  }
  return { flags, checks };
}

function openReviewIssues(s: RunState): number {
  const last = s.review_iterations[s.review_iterations.length - 1];
  if (!last) return -1;
  return last.resolved ? 0 : last.issues_found;
}
function testsPassing(s: RunState): boolean {
  const last = s.test_runs[s.test_runs.length - 1];
  return !!last && last.passed;
}
function activePhase(s: RunState): Phase | undefined {
  return s.phases.find((p) => p.status === "active") ?? s.phases.find((p) => p.status === "pending");
}
function mustState(): RunState {
  const s = read();
  if (!s) throw new Error("no active run — call `init` first.");
  return s;
}

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
/** is an absolute path inside the repo root? Containment: `--paths` must never lock/hash files
 *  outside the workspace (a deterministic gate over a known tree). */
function isInsideRoot(abs: string): boolean {
  const rel = path.relative(ROOT, abs);
  return rel === "" ? true : !rel.startsWith("..") && !path.isAbsolute(rel);
}
/** translate a shell-style glob (* ? **) to an anchored RegExp over a "/"-joined relative path */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; }
      else re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp("^" + re + "$");
}
/** expand a glob token to existing files by walking the filesystem directly — NO shell, so a
 *  `--paths` token can never be shell-interpreted (this is a deterministic gate script). */
function expandGlob(glob: string): string[] {
  const baseParts: string[] = [];
  for (const seg of glob.split("/")) { if (/[*?[\]]/.test(seg)) break; baseParts.push(seg); }
  const base = baseParts.join("/") || ".";
  if (!isInsideRoot(path.resolve(base))) return []; // containment: never scan outside the repo root
  if (!fs.existsSync(base)) return [];
  const re = globToRegExp(glob);
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (re.test(full)) out.push(full);
    }
  };
  if (fs.statSync(base).isDirectory()) walk(base);
  else if (re.test(base)) out.push(base);
  return out;
}
/** expand --paths "a b,c tests/**" into an actual file list (globs resolved WITHOUT a shell) */
function resolveTestPaths(spec: string): string[] {
  const out = new Set<string>();
  for (const tok of spec.split(/[,\s]+/).filter(Boolean)) {
    if (fs.existsSync(tok)) {
      const st = fs.statSync(tok);
      if (st.isDirectory()) {
        const r = spawnSync("find", [tok, "-type", "f"], { encoding: "utf8" });
        (r.stdout || "").split("\n").filter(Boolean).forEach((p) => out.add(p));
      } else out.add(tok);
    } else {
      // treat as a glob — resolved WITHOUT a shell, so `--paths` can never be shell-interpreted.
      for (const p of expandGlob(tok)) out.add(p);
    }
  }
  // Containment: drop anything that resolves outside the repo root (absolute paths, `../` escapes),
  // so a lock can only ever cover files within the workspace.
  return [...out].filter((p) => isInsideRoot(path.resolve(p)));
}

/** Best-effort detection of the project's EXISTING test command — a HINT for the operator to
 *  confirm, never a mandate. This workflow targets ANY repo, not just Node: the authoritative
 *  command is whatever the team already runs. `detect` only suggests it, `validation --cmd
 *  "<command>"` records it verbatim, and the gate runs exactly that. Unknown stacks fall back to
 *  asking the user. Covers the common ecosystems + task runners; extend as needed. */
function detectValidation(root: string): { command: string | null; hasTests: boolean; why: string } {
  const has = (p: string) => fs.existsSync(path.join(root, p));
  const slurp = (p: string) => { try { return fs.readFileSync(path.join(root, p), "utf8"); } catch { return ""; } };
  const anyExt = (ext: string) => { try { return fs.readdirSync(root).some((f) => f.endsWith(ext)); } catch { return false; } };
  // `src/` is source, NOT tests — counting it would wrongly suggest `adapt` for a source-only repo.
  const hasTests = ["tests", "test", "__tests__", "spec", "Tests"].some(has);
  let command: string | null = null;
  let why = "no recognizable test setup";
  const set = (c: string, w: string) => { if (!command) { command = c; why = w; } };
  try {
    // Node — honor the package manager the repo actually pins (lockfile), only if a test script exists.
    if (has("package.json")) {
      const t = (JSON.parse(slurp("package.json") || "{}").scripts?.test) as string | undefined;
      if (t && !/no test specified/i.test(t)) {
        const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : has("bun.lockb") ? "bun run" : "npm";
        set(`${pm} test`, `package.json scripts.test (${pm.split(" ")[0]})`);
      }
    }
    // Task runners are usually the team's canonical entrypoint — prefer them over a raw tool guess.
    if (has("Makefile") && /^test:/m.test(slurp("Makefile"))) set("make test", "Makefile test target");
    if ((has("justfile") || has("Justfile")) && /^test:/m.test(slurp("justfile") || slurp("Justfile"))) set("just test", "justfile test recipe");
    if (has("Taskfile.yml") && /^\s{2,}test:/m.test(slurp("Taskfile.yml"))) set("task test", "Taskfile test task");
    // Language / build ecosystems.
    if (has("pyproject.toml") || has("pytest.ini") || has("tox.ini") || has("setup.cfg")) set("pytest", "python test config");
    if (has("go.mod")) set("go test ./...", "go.mod");
    if (has("Cargo.toml")) set("cargo test", "Cargo.toml");
    if (has("Gemfile")) set(has("spec") ? "bundle exec rspec" : "bundle exec rake test", "Gemfile");
    if (has("build.gradle") || has("build.gradle.kts") || has("settings.gradle") || has("settings.gradle.kts")) set(has("gradlew") ? "./gradlew test" : "gradle test", "Gradle build");
    if (has("pom.xml")) set("mvn test", "Maven pom.xml");
    if (has("mix.exs")) set("mix test", "Elixir mix.exs");
    if (has("Package.swift")) set("swift test", "Swift package");
    if (has("composer.json")) {
      const cj = JSON.parse(slurp("composer.json") || "{}");
      if (cj.scripts?.test) set("composer test", "composer.json scripts.test");
      else if (has("phpunit.xml") || has("phpunit.xml.dist")) set("vendor/bin/phpunit", "phpunit config");
    }
    if (has("MODULE.bazel") || has("WORKSPACE") || has("WORKSPACE.bazel")) set("bazel test //...", "Bazel workspace");
    if (anyExt(".sln") || anyExt(".csproj") || anyExt(".fsproj")) set("dotnet test", ".NET project");
  } catch { /* ignore */ }
  return { command, hasTests, why };
}

// ---- commands -------------------------------------------------------------

function cmdInit(flags: Record<string, string>): void {
  const task = flags.task ?? "(unspecified task)";
  // The tier (staffing) is RESOLVED by the orchestrator before the run starts. `auto` means the
  // orchestrator chose the path from the task description — a routing decision made once, up front,
  // and recorded for audit. It must still pass the concrete tier it picked; a bare `--tier auto`
  // falls back to `full` (the safe default) so auto can never silently under-staff a run.
  const routeAuto = flags.route === "auto" || flags.tier === "auto";
  const tier: RunState["tier"] = flags.tier === "quick" ? "quick" : "full";
  const routeReason = flags.reason && flags.reason !== "true" ? flags.reason : null;
  const phases = (tier === "quick" ? QUICK_PHASES : DEFAULT_PHASES).map((p) => ({ ...p }));
  const state: RunState = {
    task, tier,
    routing: { mode: routeAuto ? "auto" : "explicit", reason: routeReason, by: flags.by ?? (routeAuto ? "orchestrator" : null) },
    started_at: now(), status: "in_progress",
    phases,
    validation: {
      mode: (flags["test-mode"] as Validation["mode"]) ?? null,
      command: flags["test-cmd"] ?? null,
      reason: null,
      decided_by: flags["test-mode"] ? "init" : null,
      at: flags["test-mode"] ? now() : null,
      manual_despite_tests: null,
    },
    test_runs: [], review_iterations: [], test_lock: null, spec_lock: null, sign_off: null, block_count: 0,
  };
  state.phases[0].status = "active";
  write(state);
  console.log(`▶ run started — status=in_progress, tier=${routeAuto ? `auto→${tier}` : tier}\n  task: ${task}`);
  if (routeAuto) console.log(`  AUTO-ROUTE: orchestrator selected ${tier}${routeReason ? ` — ${routeReason}` : ' (no reason recorded — add --reason "…")'}.`);
  if (flags.tier === "auto") console.log("  (bare --tier auto → defaulted to full; pass the resolved --tier quick|full you chose for accurate staffing.)");
  console.log("  Principle: a knowledge game, not a brute-force game — ground every action in facts (code/docs/project/web),");
  console.log("  isolate problems to their real root cause, never guess, and record learnings. State this in the brief to every persona.");
  if (tier === "quick")
    console.log("  QUICK tier: tester + implementer + reviewer only (no separate research/architecture). All four sign-off gates still apply.");
  console.log("  P0 first: assemble the brief (specs, conventions, matching LEARNINGS, acceptance criteria) before any fan-out.");
  if (!state.validation.mode)
    console.log("  then decide validation — `orchestrator detect`, then `orchestrator validation --mode …` (ask the user if unclear).");
  console.log("  · tip: /tulpkit:help make — visual map of the state machine & the four gates");
}

function cmdDetect(): void {
  const d = detectValidation(ROOT);
  if (d.command) {
    const suggest = d.hasTests ? "adapt" : "tdd";
    console.log(`detected test command: ${d.command}   (${d.why})`);
    console.log(`existing tests: ${d.hasTests ? "yes" : "none found"}  → suggested mode: ${suggest}`);
    console.log(`record it:  orchestrator validation --mode ${suggest} --cmd "${d.command}" --by detected`);
    console.log(`⚠ this is a GUESS — confirm it matches what the team actually runs (CI config / CONTRIBUTING / Makefile). If not, record the real command via --cmd.`);
  } else {
    console.log(`no test setup detected (${d.why}).`);
    console.log("ASK THE USER how to validate, then record:");
    console.log('  orchestrator validation --mode adapt  --cmd "<their command>" --by user');
    console.log('  orchestrator validation --mode tdd    --cmd "<command to create>" --by user');
    console.log('  orchestrator validation --mode manual --reason "<why no automated tests>" --by user');
  }
}

const MANUAL_REASON_MIN = 30; // a one-word "n/a" is not a recorded exception

function cmdValidation(flags: Record<string, string>): void {
  const s = mustState();
  const mode = flags.mode as Validation["mode"];
  if (!mode || !["tdd", "adapt", "manual"].includes(mode)) { console.error("✗ validation needs --mode tdd|adapt|manual"); process.exit(1); }
  if (mode !== "manual" && !flags.cmd && !s.validation.command) { console.error('✗ modes tdd/adapt need a test command: --cmd "<command>"'); process.exit(1); }

  let manualDespiteTests: string | null = null;
  if (mode === "manual") {
    const reason = flags.reason && flags.reason !== "true" ? flags.reason.trim() : "";
    if (!reason) { console.error('✗ manual mode needs --reason "<why this can\'t be validated by code>"'); process.exit(1); }
    if (reason.length < MANUAL_REASON_MIN) {
      console.error(`✗ manual --reason must explain why code can't validate this (≥ ${MANUAL_REASON_MIN} chars). Got ${reason.length}.`);
      process.exit(1);
    }
    // Mechanical floor: you cannot claim "uncodifiable" when a test runner is sitting right here.
    const det = detectValidation(ROOT);
    const force = flags["despite-detected-tests"];
    if (det.command && (!force || force === "true")) {
      console.error(`✗ manual refused: a test command is available — ${det.command} (${det.why}).`);
      console.error(`   "manual" is only for projects with NO automated validation path. Use:`);
      console.error(`     orchestrator validation --mode adapt --cmd "${det.command}"`);
      console.error(`   If that command genuinely cannot run in this environment, re-run with an audited override:`);
      console.error(`     orchestrator validation --mode manual --reason "…" --despite-detected-tests "<why ${det.command} can't run here>"`);
      process.exit(1);
    }
    if (det.command && force && force !== "true") manualDespiteTests = force;
  }

  s.validation = {
    mode,
    command: flags.cmd ?? s.validation.command ?? null,
    reason: flags.reason && flags.reason !== "true" ? flags.reason : null,
    decided_by: flags.by ?? "user",
    at: now(),
    manual_despite_tests: manualDespiteTests,
  };
  write(s);
  console.log(`✓ validation: mode=${mode}${s.validation.command ? `, cmd="${s.validation.command}"` : ""}${s.validation.reason ? `, reason="${s.validation.reason}"` : ""} (by ${s.validation.decided_by})`);
  if (manualDespiteTests) console.log(`  ⚠ manual forced past a detectable test command — audited reason: ${manualDespiteTests}`);
}

function cmdPhase(argv: string[]): void {
  const s = mustState();
  const [id, status] = argv;
  const phase = s.phases.find((p) => p.id === id);
  if (!phase) throw new Error(`unknown phase ${id}`);
  if (!["pending", "active", "done"].includes(status)) throw new Error(`bad status ${status}`);
  phase.status = status as Phase["status"];
  write(s);
  console.log(`◌ ${id} → ${status}`);
}

function cmdTestsLock(flags: Record<string, string>): void {
  const s = mustState();
  const spec = flags.paths;
  if (!spec || spec === "true") { console.error('✗ tests-lock needs --paths "<test files/dirs/globs>"'); process.exit(1); }
  const files = resolveTestPaths(spec);
  if (!files.length) { console.error(`✗ no test files matched: ${spec}`); process.exit(1); }
  const manifest: Record<string, string> = {};
  for (const f of files) manifest[path.relative(ROOT, f)] = sha256(f);
  s.test_lock = { at: now(), by: flags.by ?? "tester", files: manifest };
  write(s);
  console.log(`🔒 locked ${files.length} test file(s) by ${s.test_lock.by}:`);
  Object.keys(manifest).forEach((p) => console.log(`   ${p}`));
  console.log("   the implementer must not change these; integrity is checked at sign-off.");
}

function verifyIntegrity(s: RunState): { ok: boolean; changed: string[]; deleted: string[] } {
  const changed: string[] = [], deleted: string[] = [];
  if (!s.test_lock) return { ok: true, changed, deleted };
  for (const [rel, hash] of Object.entries(s.test_lock.files)) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { deleted.push(rel); continue; }
    if (sha256(abs) !== hash) changed.push(rel);
  }
  return { ok: changed.length === 0 && deleted.length === 0, changed, deleted };
}

function cmdTestsVerify(): void {
  const s = mustState();
  if (!s.test_lock) { console.log("no test lock recorded (tester didn't lock tests). Skipping integrity check."); return; }
  const v = verifyIntegrity(s);
  if (v.ok) { console.log(`✓ test integrity intact (${Object.keys(s.test_lock.files).length} file(s) unchanged since lock).`); return; }
  console.error("✗ TEST INTEGRITY VIOLATION — locked tests were altered after the tester locked them:");
  v.changed.forEach((p) => console.error(`   changed: ${p}`));
  v.deleted.forEach((p) => console.error(`   deleted: ${p}`));
  console.error("   If the change is legitimate, the TESTER must re-author and re-lock (`orchestrator tests-lock --by tester`).");
  process.exit(1);
}

function cmdSpecLock(flags: Record<string, string>): void {
  const s = mustState();
  const spec = flags.paths;
  if (!spec || spec === "true") { console.error('✗ spec-lock needs --paths "<spec files: the task issue.md and/or skill-spec files>"'); process.exit(1); }
  const files = resolveTestPaths(spec);
  if (!files.length) { console.error(`✗ no spec files matched: ${spec}`); process.exit(1); }
  const manifest: Record<string, string> = {};
  for (const f of files) manifest[path.relative(ROOT, f)] = sha256(f);
  const source: SpecLock["source"] = flags.source === "skill" ? "skill" : "task";
  s.spec_lock = { at: now(), by: flags.by ?? "orchestrator", source, files: manifest };
  write(s);
  console.log(`🔒 locked ${files.length} spec file(s) [${source}] by ${s.spec_lock.by}:`);
  Object.keys(manifest).forEach((p) => console.log(`   ${p}`));
  console.log("   acceptance criteria are frozen; a change after lock blocks sign-off (re-lock if the scope legitimately changes).");
}

function verifySpecIntegrity(s: RunState): { ok: boolean; changed: string[]; deleted: string[] } {
  const changed: string[] = [], deleted: string[] = [];
  if (!s.spec_lock) return { ok: true, changed, deleted };
  for (const [rel, hash] of Object.entries(s.spec_lock.files)) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { deleted.push(rel); continue; }
    if (sha256(abs) !== hash) changed.push(rel);
  }
  return { ok: changed.length === 0 && deleted.length === 0, changed, deleted };
}

function cmdSpecVerify(): void {
  const s = mustState();
  if (!s.spec_lock) { console.log("no spec lock recorded (spec was not frozen). Skipping spec-integrity check."); return; }
  const v = verifySpecIntegrity(s);
  if (v.ok) { console.log(`✓ spec integrity intact (${Object.keys(s.spec_lock.files).length} file(s) unchanged since lock).`); return; }
  console.error("✗ SPEC INTEGRITY VIOLATION — the locked acceptance criteria changed after lock:");
  v.changed.forEach((p) => console.error(`   changed: ${p}`));
  v.deleted.forEach((p) => console.error(`   deleted: ${p}`));
  console.error("   If the scope legitimately changed, re-lock: `orchestrator spec-lock --paths …`.");
  process.exit(1);
}

function cmdTest(flags: Record<string, string>): void {
  const s = mustState();
  const cmd = flags.cmd && flags.cmd !== "true" ? flags.cmd : s.validation.command;
  if (!cmd) { console.error('✗ no test command. Set one with `orchestrator validation --mode … --cmd "…"`, or pass --cmd "…".'); process.exit(1); }
  console.log(`▷ running tests: ${cmd}`);
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", timeout: TEST_TIMEOUT_MS });
  const code = r.status ?? 1;
  const passed = code === 0;
  const out = ((r.stdout || "") + (r.stderr || "")).trim().split("\n").slice(-12).join("\n");
  s.test_runs.push({ cmd, passed, code, at: now(), summary: out.slice(0, 1500) });
  write(s);
  console.log(out);
  console.log(passed ? `✓ tests GREEN (exit ${code})` : `✗ tests RED (exit ${code}) — fix and re-run`);
  if (!passed) process.exit(1);
}

function cmdReview(flags: Record<string, string>): void {
  const s = mustState();
  const n = s.review_iterations.length + 1;
  const issues = parseInt(flags.issues ?? "0", 10);
  const resolved = flags.resolved === "true";
  // optional: how many INDEPENDENT critics (different model/vendor) voted this iteration.
  // Self-preference bias means redundant independent verification catches what one reviewer misses.
  const critics = flags.critics && flags.critics !== "true" ? parseInt(flags.critics, 10) : undefined;
  s.review_iterations.push({ n, issues_found: issues, resolved, at: now(), ...(critics ? { critics } : {}) });
  write(s);
  console.log(`⟲ review #${n}: ${issues} issue(s), resolved=${resolved}${critics ? `, critics=${critics}` : ""}${flags.by ? ` (by ${flags.by})` : ""}`);
}

function cmdSignoff(flags: Record<string, string>, checks: Record<string, string>): void {
  const s = mustState();
  const v = s.validation;

  // Gate 1: executable validation, adapted to the policy.
  // No finish-line escape: "manual" must be declared up front via `validation --mode manual`
  // (where it is gated against detectable test runners), never improvised at sign-off under
  // Stop-hook pressure. There is no `--allow-no-tests` bypass.
  const manualReason = v.mode === "manual" ? v.reason : null;
  if (manualReason) {
    // You cannot go GREEN and then flip to manual to dodge an integrity violation.
    if (s.test_runs.some((t) => t.passed)) {
      console.error("✗ sign-off refused: mode=manual but a passing test run is on record.");
      console.error("   You cannot switch to manual after going green. If locked tests broke, the TESTER re-authors + re-locks — manual is not an escape hatch.");
      process.exit(1);
    }
    checks["validation"] = `MANUAL — ${manualReason}`;
    if (v.manual_despite_tests) checks["validation"] += ` (forced past detectable tests: ${v.manual_despite_tests})`;
  } else if (!v.mode) {
    console.error("✗ sign-off refused: no validation policy set. Run `orchestrator detect`, then `orchestrator validation --mode …`.");
    process.exit(1);
  } else if (!testsPassing(s)) {
    const hint = v.command ? ` (\`${v.command}\`)` : "";
    console.error(`✗ sign-off refused: no passing test run recorded for mode=${v.mode}.\n  Run \`orchestrator test\`${hint} until GREEN, or switch to manual with a recorded reason.`);
    process.exit(1);
  } else {
    const last = s.test_runs[s.test_runs.length - 1];
    if (!checks["tests"]) checks["tests"] = `${v.mode}: \`${last.cmd}\` exit 0 (${s.test_runs.length} run(s))`;
  }

  // Gate 2: TEST INTEGRITY — the gate must not have been gamed. Verified whenever a lock exists,
  // REGARDLESS of validation mode: a `manual` exception must never become a way to dodge a
  // tampered locked test, since the lock is the trust anchor for the whole validation gate.
  if (s.test_lock) {
    const integ = verifyIntegrity(s);
    if (!integ.ok) {
      console.error("✗ sign-off refused: TEST INTEGRITY VIOLATION (the validation gate may have been gamed).");
      integ.changed.forEach((p) => console.error(`   changed after lock: ${p}`));
      integ.deleted.forEach((p) => console.error(`   deleted after lock: ${p}`));
      console.error("   Green tests only count if the tester's locked tests are intact. Tester must re-author + re-lock if the change is legitimate.");
      process.exit(1);
    }
    checks["test_integrity"] = `locked ${Object.keys(s.test_lock.files).length} test file(s); intact at sign-off`;
  }

  // Gate 3: SPEC-CONFORMANCE attestation — not just "tests pass".
  const specKey = Object.keys(checks).find((k) => /^spec(_conformance)?$/i.test(k));
  if (!specKey || !(checks[specKey] && checks[specKey].trim().length > 2)) {
    console.error('✗ sign-off refused: missing spec-conformance attestation. Add `--check spec_conformance="…how the implementation meets the acceptance criteria, beyond tests passing…"`.');
    process.exit(1);
  }
  // Gate 3 (hardened): if the spec was locked, its frozen acceptance criteria must be intact —
  // you cannot quietly relax the spec to make weak work "conform". Mirrors the test-integrity lock.
  // Absent a spec_lock, the free-text attestation alone applies (backward-compatible).
  if (s.spec_lock) {
    const sv = verifySpecIntegrity(s);
    if (!sv.ok) {
      console.error("✗ sign-off refused: SPEC INTEGRITY VIOLATION (the locked acceptance criteria changed after lock).");
      sv.changed.forEach((p) => console.error(`   changed after lock: ${p}`));
      sv.deleted.forEach((p) => console.error(`   deleted after lock: ${p}`));
      console.error("   Conformance only counts against the frozen spec. Re-lock with `orchestrator spec-lock` if the scope legitimately changed.");
      process.exit(1);
    }
    checks["spec_integrity"] = `locked ${Object.keys(s.spec_lock.files).length} spec file(s) [${s.spec_lock.source}]; intact at sign-off`;
  }

  // Optional strengthening (off by default): require an N-critic verification panel on the final
  // review. Independent critics (different model/vendor) catch what one reviewer misses. This never
  // lowers the floor — it only adds a requirement when the operator opts in via --min-critics.
  const minCritics = flags["min-critics"] && flags["min-critics"] !== "true" ? parseInt(flags["min-critics"], 10) : 0;
  if (minCritics > 0) {
    const last = s.review_iterations[s.review_iterations.length - 1];
    const got = last?.critics ?? (last ? 1 : 0);
    if (got < minCritics) {
      console.error(`✗ sign-off refused: --min-critics ${minCritics} requested but the final review had ${got} critic(s). Run an N-critic panel and record it with \`orchestrator review --critics ${minCritics} …\`.`);
      process.exit(1);
    }
    checks["review_panel"] = `${got} independent critics (≥ ${minCritics} required)`;
  }

  // Gate 4: auditable checklist + zero open issues.
  const nonEmpty = Object.entries(checks).filter(([, val]) => val && val.trim().length > 2);
  if (nonEmpty.length < MIN_CHECKLIST_ITEMS) {
    console.error(`✗ sign-off refused: auditable checklist needs ≥ ${MIN_CHECKLIST_ITEMS} non-empty items, got ${nonEmpty.length}.`);
    process.exit(1);
  }
  // Gate 4b: a review must actually have happened AND resolved. `/tulpkit:make` promises the
  // reviewer signs off, so make it mechanical: no review on record (or an unresolved final
  // review) means the run is NOT signed off, even with everything else green. This also closes
  // the subtle hole where a review with resolved=false but issues_found=0 used to slip through.
  const lastReview = s.review_iterations[s.review_iterations.length - 1];
  if (!lastReview) {
    console.error("✗ sign-off refused: no review recorded. The reviewer (≠ implementer; Codex if available) must review, recorded via `orchestrator review --resolved true …`, before sign-off.");
    process.exit(1);
  }
  if (!lastReview.resolved) {
    console.error(`✗ sign-off refused: the final review is unresolved (${lastReview.issues_found} open issue(s)). Fix every issue, then re-record with \`orchestrator review --resolved true\`.`);
    process.exit(1);
  }

  s.phases.forEach((p) => (p.status = "done"));
  s.sign_off = { approved_by: flags.by ?? "code-reviewer", at: now(), checklist: Object.fromEntries(nonEmpty) };
  s.status = "complete";
  write(s);
  console.log(`✓ SIGNED OFF by ${s.sign_off.approved_by} — run complete. The session may now finish.`);
}

function cmdStatus(): void {
  const s = read();
  if (!s) { console.log("no active run."); return; }
  const ap = activePhase(s);
  const lastTest = s.test_runs[s.test_runs.length - 1];
  const v = s.validation;
  const integ = s.test_lock ? verifyIntegrity(s) : null;
  console.log(`task        : ${s.task}`);
  console.log(`tier        : ${s.tier ?? "full"}${s.routing?.mode === "auto" ? "  (auto-routed)" : ""}`);
  if (s.routing?.mode === "auto") console.log(`route       : auto — ${s.routing.reason ?? "(no reason recorded)"}`);
  console.log(`status      : ${s.status}`);
  console.log(`phases      : ${s.phases.map((p) => `${p.id}:${p.status}`).join("  ")}`);
  console.log(`validation  : ${v.mode ? `${v.mode}${v.command ? ` (${v.command})` : ""}${v.reason ? ` — ${v.reason}` : ""}` : "NOT DECIDED — detect or ask the user"}`);
  console.log(`tests       : ${lastTest ? (lastTest.passed ? `GREEN (${s.test_runs.length} run)` : "RED — fix") : v.mode === "manual" ? "n/a (manual)" : "none run yet"}`);
  console.log(`test lock   : ${s.test_lock ? (integ && integ.ok ? `intact (${Object.keys(s.test_lock.files).length} files)` : "VIOLATED — locked tests changed") : "not locked"}`);
  const specInteg = s.spec_lock ? verifySpecIntegrity(s) : null;
  console.log(`spec lock   : ${s.spec_lock ? (specInteg && specInteg.ok ? `intact (${Object.keys(s.spec_lock.files).length} files, ${s.spec_lock.source})` : "VIOLATED — locked spec changed") : "not locked"}`);
  console.log(`reviews     : ${s.review_iterations.length} (open issues: ${Math.max(0, openReviewIssues(s))})`);
  console.log(`sign-off    : ${s.sign_off ? `yes, by ${s.sign_off.approved_by}` : "NOT YET"}`);
  console.log(`stop        : ${s.status === "complete" ? "ALLOWED" : "BLOCKED — keep working"}`);
  if (s.status !== "complete" && ap) console.log(`next        : drive ${ap.id} — ${ap.name}`);
  console.log("· tip: /tulpkit:help make — visual map of the state machine & the four gates");
}

function cmdAbort(): void {
  const s = read();
  if (!s) return;
  s.status = "aborted";
  write(s);
  console.log("run aborted — stop is now allowed.");
}

function main(): void {
  process.stdout.on("error", (e: NodeJS.ErrnoException) => { if (e.code === "EPIPE") process.exit(0); });
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, checks } = parseArgs(rest);
  switch (cmd) {
    case "init": return cmdInit(flags);
    case "detect": return cmdDetect();
    case "validation": return cmdValidation(flags);
    case "phase": return cmdPhase(rest);
    case "tests-lock": return cmdTestsLock(flags);
    case "tests-verify": return cmdTestsVerify();
    case "spec-lock": return cmdSpecLock(flags);
    case "spec-verify": return cmdSpecVerify();
    case "test": return cmdTest(flags);
    case "review": return cmdReview(flags);
    case "signoff": return cmdSignoff(flags, checks);
    case "status": return cmdStatus();
    case "abort": return cmdAbort();
    default:
      console.error("usage: orchestrator <init|detect|validation|phase|tests-lock|tests-verify|spec-lock|spec-verify|test|review|signoff|status|abort> [...]");
      process.exit(1);
  }
}
main();
