#!/usr/bin/env -S npx tsx
/**
 * selftest.ts — executable validation for the plugin's own deterministic core.
 *
 * No framework, no runtime deps (the plugin's house style). It exercises the four scripts in
 * throwaway temp dirs and asserts on exit codes + key output, plus the Stop-hook stdin/stdout
 * contract and the plugin's static structure. It canNOT test the live multi-agent loop — that
 * needs a real Claude Code session driving subagents.
 *
 *   npm test     (→ tsx scripts/selftest.ts)
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");
const ORCH = path.join(REPO, "scripts", "orchestrator.ts");
const TASKS = path.join(REPO, "scripts", "tasks.ts");
const CODEX = path.join(REPO, "scripts", "codex.ts");
const HOOK = path.join(REPO, "scripts", "enforce-signoff.ts");

if (!fs.existsSync(TSX)) {
  console.error(`✗ ${TSX} missing — run \`npm install\` first.`);
  process.exit(1);
}

// ---- tiny harness ---------------------------------------------------------
let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function section(name: string): void { console.log(`\n• ${name}`); }

type Run = { code: number; out: string };
function run(script: string, args: string[], opts: { cwd?: string; input?: string } = {}): Run {
  const r = spawnSync(TSX, [script, ...args], {
    cwd: opts.cwd ?? REPO, encoding: "utf8", input: opts.input, timeout: 60_000,
  });
  return { code: r.status ?? 1, out: ((r.stdout || "") + (r.stderr || "")) };
}
function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), "tulptest-")); }
function rm(d: string): void { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }

const o = (cwd: string, ...args: string[]) => run(ORCH, args, { cwd });
const t = (cwd: string, ...args: string[]) => run(TASKS, args, { cwd });

// ---- orchestrator: state machine + the four gates -------------------------
function testOrchestrator(): void {
  section("orchestrator — gates");

  // happy path (full tier): adapt + green + locked tests + full checklist → SIGNED OFF
  {
    const d = tmp();
    fs.mkdirSync(path.join(d, "tests"));
    fs.writeFileSync(path.join(d, "tests", "a.txt"), "x");
    o(d, "init", "--task", "happy");
    o(d, "validation", "--mode", "adapt", "--cmd", "true");
    o(d, "tests-lock", "--paths", "tests");
    const test = o(d, "test");
    check("happy: test run is green", test.code === 0 && /GREEN/.test(test.out));
    const so = o(d, "signoff", "--by", "code-reviewer",
      "--check", "spec_conformance=meets the acceptance criteria",
      "--check", "correctness=verified vs source",
      "--check", "coverage=edge cases included",
      "--check", "integration=wired in");
    check("happy: signs off", so.code === 0 && /SIGNED OFF/.test(so.out), so.out.trim());
    rm(d);
  }

  // gate: spec_conformance is mandatory
  {
    const d = tmp();
    o(d, "init", "--task", "x");
    o(d, "validation", "--mode", "adapt", "--cmd", "true");
    o(d, "test");
    const so = o(d, "signoff", "--by", "r", "--check", "a=aaaa", "--check", "b=bbbb", "--check", "c=cccc", "--check", "e=eeee");
    check("refuses sign-off without spec_conformance", so.code === 1 && /spec-conformance/.test(so.out));
    rm(d);
  }

  // gate: ≥4 checklist items
  {
    const d = tmp();
    o(d, "init", "--task", "x");
    o(d, "validation", "--mode", "adapt", "--cmd", "true");
    o(d, "test");
    const so = o(d, "signoff", "--by", "r", "--check", "spec_conformance=meets criteria");
    check("refuses sign-off with <4 checklist items", so.code === 1 && /checklist/.test(so.out));
    rm(d);
  }

  // gate: red tests block sign-off
  {
    const d = tmp();
    o(d, "init", "--task", "x");
    o(d, "validation", "--mode", "adapt", "--cmd", "false");
    const test = o(d, "test");
    check("red test run exits non-zero", test.code === 1 && /RED/.test(test.out));
    const so = o(d, "signoff", "--by", "r", "--check", "spec_conformance=meets", "--check", "a=aaaa", "--check", "b=bbbb", "--check", "c=cccc");
    check("refuses sign-off when tests not green", so.code === 1 && /no passing test run/.test(so.out));
    rm(d);
  }

  section("orchestrator — test integrity");
  {
    const d = tmp();
    fs.mkdirSync(path.join(d, "tests"));
    const f = path.join(d, "tests", "a.txt");
    fs.writeFileSync(f, "original");
    o(d, "init", "--task", "x");
    o(d, "validation", "--mode", "adapt", "--cmd", "true");
    o(d, "tests-lock", "--paths", "tests");
    check("tests-verify clean right after lock", o(d, "tests-verify").code === 0);
    fs.writeFileSync(f, "TAMPERED");
    const v = o(d, "tests-verify");
    check("tests-verify catches a tampered locked test", v.code === 1 && /INTEGRITY VIOLATION/.test(v.out));
    o(d, "test");
    const so = o(d, "signoff", "--by", "r", "--check", "spec_conformance=meets", "--check", "a=aaaa", "--check", "b=bbbb", "--check", "c=cccc");
    check("sign-off refused after integrity violation", so.code === 1 && /INTEGRITY VIOLATION/.test(so.out));
    rm(d);
  }

  section("orchestrator — spec lock (Gate 3 hardened)");

  // happy: a locked spec left intact → signs off
  {
    const d = tmp();
    fs.writeFileSync(path.join(d, "spec.md"), "acceptance: do X fully");
    o(d, "init", "--task", "x");
    o(d, "validation", "--mode", "adapt", "--cmd", "true");
    o(d, "spec-lock", "--paths", "spec.md");
    check("spec-verify clean right after lock", o(d, "spec-verify").code === 0);
    o(d, "test");
    const so = o(d, "signoff", "--by", "r", "--check", "spec_conformance=meets", "--check", "a=aaaa", "--check", "b=bbbb", "--check", "c=cccc");
    check("signs off with locked spec intact", so.code === 0 && /SIGNED OFF/.test(so.out), so.out.trim());
    rm(d);
  }

  // a relaxed (tampered) locked spec → sign-off refused
  {
    const d = tmp();
    const sp = path.join(d, "spec.md");
    fs.writeFileSync(sp, "acceptance: do X fully");
    o(d, "init", "--task", "x");
    o(d, "validation", "--mode", "adapt", "--cmd", "true");
    o(d, "spec-lock", "--paths", "spec.md");
    fs.writeFileSync(sp, "acceptance: do less"); // relax the criteria after lock
    const v = o(d, "spec-verify");
    check("spec-verify catches a tampered locked spec", v.code === 1 && /SPEC INTEGRITY VIOLATION/.test(v.out));
    o(d, "test");
    const so = o(d, "signoff", "--by", "r", "--check", "spec_conformance=meets", "--check", "a=aaaa", "--check", "b=bbbb", "--check", "c=cccc");
    check("sign-off refused after the locked spec was relaxed", so.code === 1 && /SPEC INTEGRITY VIOLATION/.test(so.out));
    rm(d);
  }

  // backward-compat: no spec lock → the free-text attestation alone still signs off
  {
    const d = tmp();
    o(d, "init", "--task", "x");
    o(d, "validation", "--mode", "adapt", "--cmd", "true");
    o(d, "test");
    const so = o(d, "signoff", "--by", "r", "--check", "spec_conformance=meets", "--check", "a=aaaa", "--check", "b=bbbb", "--check", "c=cccc");
    check("no spec lock → free-text attestation still signs off", so.code === 0 && /SIGNED OFF/.test(so.out), so.out.trim());
    rm(d);
  }

  section("orchestrator — manual fence (hardened escape gate)");

  // manual refused when a test runner is detectable
  {
    const d = tmp();
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ scripts: { test: "exit 0" } }));
    o(d, "init", "--task", "x");
    const v = o(d, "validation", "--mode", "manual", "--reason", "I would simply prefer not to write any tests now");
    check("manual refused when npm test is detectable", v.code === 1 && /manual refused/.test(v.out));
    rm(d);
  }

  // manual override allowed (audited) past detectable tests
  {
    const d = tmp();
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ scripts: { test: "exit 0" } }));
    o(d, "init", "--task", "x");
    const v = o(d, "validation", "--mode", "manual",
      "--reason", "the suite needs a GPU runner not present in this environment",
      "--despite-detected-tests", "npm test requires CUDA, absent here");
    check("manual override accepted with audited --despite-detected-tests", v.code === 0 && /forced past a detectable test command/.test(v.out));
    rm(d);
  }

  // manual reason length floor (no detectable runner → only the floor applies)
  {
    const d = tmp();
    o(d, "init", "--task", "x");
    const v = o(d, "validation", "--mode", "manual", "--reason", "n/a");
    check("manual reason length floor enforced", v.code === 1 && /≥ 30 chars/.test(v.out));
    rm(d);
  }

  // green → manual flip is blocked at sign-off
  {
    const d = tmp();
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ scripts: { test: "exit 0" } }));
    o(d, "init", "--task", "x");
    o(d, "validation", "--mode", "adapt", "--cmd", "true");
    o(d, "test"); // record a green run
    o(d, "validation", "--mode", "manual", "--reason", "trying to escape after going green to dodge it", "--despite-detected-tests", "pretend it cannot run");
    const so = o(d, "signoff", "--by", "r", "--check", "spec_conformance=meets", "--check", "a=aaaa", "--check", "b=bbbb", "--check", "c=cccc");
    check("green→manual flip blocked at sign-off", so.code === 1 && /passing test run is on record/.test(so.out));
    rm(d);
  }

  // dead --allow-no-tests is inert
  {
    const d = tmp();
    o(d, "init", "--task", "x");
    const so = o(d, "signoff", "--by", "r", "--allow-no-tests", "please let me stop",
      "--check", "spec_conformance=meets", "--check", "a=aaaa", "--check", "b=bbbb", "--check", "c=cccc");
    check("--allow-no-tests no longer bypasses validation", so.code === 1 && /no validation policy set/.test(so.out));
    rm(d);
  }

  section("orchestrator — tiers");
  {
    const d = tmp();
    o(d, "init", "--task", "x", "--tier", "quick");
    const st = o(d, "status").out;
    check("quick tier recorded", /tier\s*:\s*quick/.test(st));
    check("quick tier uses P0/P2/P4 only", /P0:.*P2:.*P4:/.test(st) && !/P1:/.test(st) && !/P3:/.test(st));
    rm(d);
  }
  {
    const d = tmp();
    o(d, "init", "--task", "x");
    const st = o(d, "status").out;
    check("default tier is full", /tier\s*:\s*full/.test(st) && /P1:/.test(st) && /P3:/.test(st));
    rm(d);
  }

  section("orchestrator — multi-vote review panel (opt-in)");
  // --min-critics refuses a too-small panel
  {
    const d = tmp();
    o(d, "init", "--task", "x");
    o(d, "validation", "--mode", "adapt", "--cmd", "true");
    o(d, "test");
    o(d, "review", "--issues", "0", "--resolved", "true"); // single reviewer
    const so = o(d, "signoff", "--by", "r", "--min-critics", "3", "--check", "spec_conformance=meets", "--check", "a=aaaa", "--check", "b=bbbb", "--check", "c=cccc");
    check("--min-critics refuses a too-small panel", so.code === 1 && /min-critics/.test(so.out));
    rm(d);
  }
  // satisfied by a recorded 3-critic panel
  {
    const d = tmp();
    o(d, "init", "--task", "x");
    o(d, "validation", "--mode", "adapt", "--cmd", "true");
    o(d, "test");
    o(d, "review", "--issues", "0", "--resolved", "true", "--critics", "3");
    const so = o(d, "signoff", "--by", "r", "--min-critics", "3", "--check", "spec_conformance=meets", "--check", "a=aaaa", "--check", "b=bbbb", "--check", "c=cccc");
    check("--min-critics satisfied by a 3-critic panel", so.code === 0 && /SIGNED OFF/.test(so.out), so.out.trim());
    rm(d);
  }

  // abort releases the guard
  {
    const d = tmp();
    o(d, "init", "--task", "x");
    o(d, "abort");
    check("abort sets status=aborted", /aborted/.test(o(d, "status").out));
    rm(d);
  }
}

// ---- tasks: folder + symlink system ---------------------------------------
function testTasks(): void {
  section("tasks — lifecycle & symlinks");
  const d = tmp();

  const n1 = t(d, "new", "--as", "task", "--title", "Add listening page");
  const folder = "task-0001-add-listening-page";
  check("new creates the slugged folder", n1.code === 0 && fs.existsSync(path.join(d, "tasks", "list", folder, "issue.md")), n1.out.trim());

  const link = path.join(d, "tasks", "by-state", "pending", folder);
  let isLink = false, target = "";
  try { isLink = fs.lstatSync(link).isSymbolicLink(); target = fs.readlinkSync(link); } catch { /* */ }
  check("state is a relative symlink into list/", isLink && target === path.join("..", "..", "list", folder), `target=${target}`);

  const issue = fs.readFileSync(path.join(d, "tasks", "list", folder, "issue.md"), "utf8");
  check("issue.md frontmatter mirrors state=pending", /^state:\s*pending$/m.test(issue));

  check("list shows the pending task", /task-0001-add-listening-page/.test(t(d, "list").out));

  t(d, "move", "--task", "1", "--to", "inprogress");
  check("move relinks to inprogress", fs.existsSync(path.join(d, "tasks", "by-state", "inprogress", folder)) && !fs.existsSync(link));
  const moved = fs.readFileSync(path.join(d, "tasks", "list", folder, "issue.md"), "utf8");
  check("move updates frontmatter to inprogress", /^state:\s*inprogress$/m.test(moved));

  const n2 = t(d, "new", "--as", "bug", "--title", "Crash on empty input");
  const bugFolder = "issue-0002-crash-on-empty-input";
  check("ids auto-increment per root", n2.code === 0 && fs.existsSync(path.join(d, "tasks", "list", bugFolder)));
  check("bug → type issue + kind: bug", /^type:\s*issue$/m.test(fs.readFileSync(path.join(d, "tasks", "list", bugFolder, "issue.md"), "utf8")) &&
    /^kind:\s*bug$/m.test(fs.readFileSync(path.join(d, "tasks", "list", bugFolder, "issue.md"), "utf8")));

  check("show exits 0 for an existing task", t(d, "show", "--task", "1").code === 0);
  check("show exits 1 for a missing task", t(d, "show", "--task", "999").code === 1);

  t(d, "remove", "--task", "1");
  check("remove deletes folder + symlink", !fs.existsSync(path.join(d, "tasks", "list", folder)) &&
    !fs.existsSync(path.join(d, "tasks", "by-state", "inprogress", folder)));

  rm(d);
}

// ---- tasks: nesting (parent/order/tree/cascade) + spec/tier frontmatter ---
function testTasksNesting(): void {
  section("tasks — nesting (parent/order/tree/cascade) & spec/tier frontmatter");
  const d = tmp();

  t(d, "new", "--as", "feature", "--title", "Auth");                                              // id 1 (root)
  const root = "feature-0001-auth";
  t(d, "new", "--as", "task", "--title", "Login form", "--parent", "1", "--order", "2", "--spec", "task", "--tier", "quick");        // id 2
  t(d, "new", "--as", "feature", "--title", "OAuth", "--parent", "1", "--order", "1", "--spec", "skill:oauth", "--tier", "full");    // id 3

  const child = fs.readFileSync(path.join(d, "tasks", "list", "task-0002-login-form", "issue.md"), "utf8");
  check("child records parent + order", /^parent:\s*feature-0001-auth$/m.test(child) && /^order:\s*2$/m.test(child));
  check("task-spec + tier hint recorded", /^spec:\s*task$/m.test(child) && /^tier:\s*quick$/m.test(child));
  check("skill-spec frontmatter recorded",
    /^spec:\s*skill:oauth$/m.test(fs.readFileSync(path.join(d, "tasks", "list", "feature-0003-oauth", "issue.md"), "utf8")));
  check("root has no parent line", !/^parent:/m.test(fs.readFileSync(path.join(d, "tasks", "list", root, "issue.md"), "utf8")));

  const tree = t(d, "tree").out;
  check("tree shows root and both children", /feature-0001-auth/.test(tree) && /task-0002-login-form/.test(tree) && /feature-0003-oauth/.test(tree));
  check("tree sorts siblings by order (oauth ord1 before login ord2)", tree.indexOf("feature-0003-oauth") < tree.indexOf("task-0002-login-form"));

  const r1 = t(d, "remove", "--task", "1");
  check("remove parent refused without --cascade", r1.code === 1 && /cascade/.test(r1.out));
  const r2 = t(d, "remove", "--task", "1", "--cascade");
  check("remove --cascade deletes the whole subtree", r2.code === 0 &&
    !fs.existsSync(path.join(d, "tasks", "list", root)) &&
    !fs.existsSync(path.join(d, "tasks", "list", "task-0002-login-form")) &&
    !fs.existsSync(path.join(d, "tasks", "list", "feature-0003-oauth")));

  rm(d);
}

// ---- Stop hook: stdin/stdout decision contract ----------------------------
function writeState(dir: string, state: Record<string, unknown>): void {
  const sd = path.join(dir, ".claude", "orchestrator");
  fs.mkdirSync(sd, { recursive: true });
  fs.writeFileSync(path.join(sd, "run-state.json"), JSON.stringify(state, null, 2));
}
const baseState = (over: Record<string, unknown>) => ({
  task: "x", tier: "full", status: "in_progress", phases: [{ id: "P0", name: "brief", status: "active" }],
  validation: { mode: null, command: null, reason: null }, test_runs: [], review_iterations: [],
  sign_off: null, block_count: 0, ...over,
});
function hook(dir: string): Run {
  return run(HOOK, [], { cwd: dir, input: JSON.stringify({ cwd: dir }) });
}

function testHook(): void {
  section("Stop hook — block/allow contract");

  // no run in flight → allow (no output)
  {
    const d = tmp();
    const r = hook(d);
    check("allows stop when no run-state exists", r.code === 0 && !/decision/.test(r.out));
    rm(d);
  }

  // active + unsigned → block, and block_count increments
  {
    const d = tmp();
    writeState(d, baseState({}));
    const r = hook(d);
    check("blocks stop while active and unsigned", r.code === 0 && /"decision"\s*:\s*"block"/.test(r.out));
    const after = JSON.parse(fs.readFileSync(path.join(d, ".claude", "orchestrator", "run-state.json"), "utf8"));
    check("hook increments block_count", after.block_count === 1);
    rm(d);
  }

  // signed off → allow
  {
    const d = tmp();
    writeState(d, baseState({ sign_off: { approved_by: "r", at: "now", checklist: {} } }));
    const r = hook(d);
    check("allows stop once signed off", r.code === 0 && !/block/.test(r.out));
    rm(d);
  }

  // complete/aborted → allow
  {
    const d = tmp();
    writeState(d, baseState({ status: "complete" }));
    check("allows stop when status=complete", !/block/.test(hook(d).out));
    rm(d);
  }

  // safety valve at MAX_BLOCKS
  {
    const d = tmp();
    writeState(d, baseState({ block_count: 8 }));
    const r = hook(d);
    check("safety valve releases after MAX_BLOCKS", r.code === 0 && /systemMessage/.test(r.out) && !/"decision"\s*:\s*"block"/.test(r.out));
    rm(d);
  }
}

// ---- codex bridge: detect contract ---------------------------------------
function testCodex(): void {
  section("codex — detect contract");
  const r = run(CODEX, ["detect"]);
  let parsed: any = null;
  try { parsed = JSON.parse(r.out.trim().split("\n").pop() || ""); } catch { /* */ }
  check("detect emits a JSON verdict with an `available` boolean", parsed && typeof parsed.available === "boolean", r.out.trim());
  check("detect exit code matches availability", (r.code === 0) === (parsed?.available === true));
  console.log(`    (codex ${parsed?.available ? "IS" : "is NOT"} available here: ${parsed?.reason})`);
}

// ---- static structure: manifests + component wiring -----------------------
function testStructure(): void {
  section("plugin structure");
  const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(REPO, p), "utf8"));

  const plugin = readJson(".claude-plugin/plugin.json");
  check("plugin.json names the plugin 'tulpkit'", plugin.name === "tulpkit");

  const market = readJson(".claude-plugin/marketplace.json");
  const entry = (market.plugins || []).find((p: any) => p.name === "tulpkit");
  check("marketplace lists the tulpkit plugin", !!entry);

  const hooks = readJson("hooks/hooks.json");
  const cmd = hooks?.Stop?.[0]?.hooks?.[0]?.command || "";
  check("Stop hook points at enforce-signoff.ts", /enforce-signoff\.ts/.test(cmd) && fs.existsSync(HOOK));

  // every agent/command/skill has the frontmatter the loader needs
  const hasFm = (file: string, keys: string[]) => {
    const txt = fs.readFileSync(file, "utf8");
    const m = txt.match(/^---\n([\s\S]*?)\n---/);
    return !!m && keys.every((k) => new RegExp(`^${k}:`, "m").test(m[1]));
  };
  for (const a of fs.readdirSync(path.join(REPO, "agents")))
    check(`agent ${a} has name+description frontmatter`, hasFm(path.join(REPO, "agents", a), ["name", "description"]));
  for (const c of fs.readdirSync(path.join(REPO, "commands")))
    check(`command ${c} has description frontmatter`, hasFm(path.join(REPO, "commands", c), ["description"]));
  for (const s of fs.readdirSync(path.join(REPO, "skills"))) {
    const skill = path.join(REPO, "skills", s, "SKILL.md");
    check(`skill ${s} has SKILL.md with name+description`, fs.existsSync(skill) && hasFm(skill, ["name", "description"]));
  }

  // the grounding philosophy must reach the orchestrator AND every persona
  const contains = (rel: string, re: RegExp) => re.test(fs.readFileSync(path.join(REPO, rel), "utf8"));
  check("grounding philosophy is in the preloaded specialist-protocol",
    contains("skills/specialist-protocol/SKILL.md", /knowledge game,\s+not a brute-force\s+game/i));
  check("grounding philosophy is in the orchestrator skill",
    contains("skills/orchestrated-delivery/SKILL.md", /knowledge game,\s+not a brute-force\s+game/i));
  check("grounding philosophy is in the composed brief template",
    contains("skills/orchestrated-delivery/prompt-template.md", /knowledge game,\s+not a brute-force\s+game/i));
}

// ---- run ------------------------------------------------------------------
console.log("tulpkit self-test — deterministic core\n=======================================");
testStructure();
testOrchestrator();
testTasks();
testTasksNesting();
testHook();
testCodex();

console.log(`\n=======================================`);
if (failures.length) {
  console.error(`✗ ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`✓ all ${passed} checks passed`);
