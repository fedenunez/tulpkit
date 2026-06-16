#!/usr/bin/env -S npx tsx
/**
 * codex.ts — optional CROSS-VENDOR bridge to OpenAI's Codex CLI.
 *
 * Why: self-preference bias is strongest *within a model family*, so the most independent
 * reviewer/tester is a different vendor's model. If the user has Codex installed and logged in,
 * we route the review (and optionally test authorship) through it; otherwise we exit with code 2
 * so the orchestrator falls back to the in-session code-reviewer subagent (on a different Claude
 * model than the implementer).
 *
 * Codex facts (verified against developers.openai.com/codex):
 *   - `codex exec "<prompt>"`  runs headless; final message → stdout, progress → stderr.
 *   - `codex exec --json`      emits JSONL events; assistant text is in `item.text`.
 *   - default sandbox is read-only (ideal for a reviewer); `--skip-git-repo-check` for non-git.
 *   - auth via `codex login` (creds under ~/.codex/) or CODEX_API_KEY/OPENAI_API_KEY.
 *
 *   codex.ts detect [--probe]                 → JSON {available, version, authed, reason}; exit 0 if usable, 1 if not
 *   codex.ts review [--base <ref>] [--diff f] → cross-vendor review of the diff; prints verdict JSON; exit 2 if Codex unusable
 *   codex.ts test   --spec <text|@file> [--dir tests] → Codex authors a first cut of tests; exit 2 if unusable
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const FALLBACK = 2; // exit code meaning "Codex unusable — fall back to the in-session reviewer"

function flags(argv: string[]): Record<string, string> {
  const f: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2);
    f[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
  }
  return f;
}

function codexVersion(): string | null {
  const r = spawnSync("codex", ["--version"], { encoding: "utf8", timeout: 15000 });
  if (r.status === 0 && r.stdout) return r.stdout.trim();
  return null;
}

function authSignal(): { authed: boolean; how: string } {
  if (process.env.CODEX_API_KEY) return { authed: true, how: "CODEX_API_KEY" };
  if (process.env.OPENAI_API_KEY) return { authed: true, how: "OPENAI_API_KEY" };
  const authFile = path.join(os.homedir(), ".codex", "auth.json");
  if (fs.existsSync(authFile)) return { authed: true, how: "~/.codex/auth.json" };
  return { authed: false, how: "no API key env and no ~/.codex/auth.json" };
}

/** live probe: actually run a tiny exec to confirm the login works (costs one small call) */
function probe(): boolean {
  const r = spawnSync("codex", ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "reply with the single word READY"],
    { encoding: "utf8", timeout: 90000 });
  return r.status === 0 && /READY/i.test((r.stdout || "") + (r.stderr || ""));
}

function detectInfo(doProbe: boolean) {
  const version = codexVersion();
  if (!version) return { available: false, version: null as string | null, authed: false, reason: "codex CLI not found on PATH" };
  const a = authSignal();
  let authed = a.authed;
  let reason = a.authed ? `installed; auth via ${a.how}` : `installed but not logged in (${a.how}) — run \`codex login\``;
  if (doProbe) {
    authed = probe();
    reason = authed ? "installed; live probe READY" : "installed; live probe failed (login/quota?)";
  }
  return { available: !!version && authed, version, authed, reason };
}

function cmdDetect(f: Record<string, string>): void {
  const info = detectInfo(f.probe === "true");
  console.log(JSON.stringify(info));
  process.exit(info.available ? 0 : 1);
}

function getDiff(f: Record<string, string>): string {
  if (f.diff && f.diff !== "true") return fs.readFileSync(f.diff, "utf8");
  const base = f.base && f.base !== "true" ? f.base : "HEAD";
  const r = spawnSync("git", ["diff", base], { encoding: "utf8", timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  let d = r.status === 0 ? r.stdout : "";
  const staged = spawnSync("git", ["diff", "--cached"], { encoding: "utf8", timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  if (staged.status === 0 && staged.stdout) d += "\n" + staged.stdout;
  return d.trim();
}

/** pull the last assistant text out of codex's JSONL event stream */
function lastText(jsonl: string): string {
  let text = "";
  for (const line of jsonl.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    try {
      const o = JSON.parse(s);
      const t = o?.item?.text ?? o?.text ?? (typeof o?.item?.content === "string" ? o.item.content : null);
      if (typeof t === "string" && t.trim()) text = t;
    } catch { /* skip non-JSON lines */ }
  }
  return text;
}

function extractVerdict(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  return { verdict: "UNKNOWN", raw: text.slice(0, 4000) };
}

function cmdReview(f: Record<string, string>): void {
  const info = detectInfo(false);
  if (!info.available) { console.error(`codex unavailable: ${info.reason}`); process.exit(FALLBACK); }
  const diff = getDiff(f);
  if (!diff) { console.error("no diff to review (nothing changed vs base)"); process.exit(FALLBACK); }

  const prompt =
`You are an INDEPENDENT cross-vendor code reviewer. You did NOT write this code. Be a neutral
skeptic: confront problems, do not flatter. Review the following diff for correctness, spec
risks, missing tests, security and error handling. Critically, check whether any TEST files were
weakened, deleted, or hard-coded to pass rather than the production code being fixed.

Respond with ONLY a JSON object, no prose, of the form:
{"verdict":"PASS"|"FAIL","issues":[{"severity":"high"|"med"|"low","file":"...","detail":"..."}],"summary":"..."}

DIFF:
${diff.slice(0, 200000)}`;

  const r = spawnSync("codex", ["exec", "--json", "--sandbox", "read-only", "--skip-git-repo-check", "-"],
    { input: prompt, encoding: "utf8", timeout: 6 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && !r.stdout) { console.error(`codex exec failed: ${(r.stderr || "").slice(0, 500)}`); process.exit(FALLBACK); }
  const verdict = extractVerdict(lastText(r.stdout || ""));
  console.log(JSON.stringify(verdict, null, 2));
}

function cmdTest(f: Record<string, string>): void {
  const info = detectInfo(false);
  if (!info.available) { console.error(`codex unavailable: ${info.reason}`); process.exit(FALLBACK); }
  let spec = f.spec ?? "";
  if (spec.startsWith("@")) spec = fs.readFileSync(spec.slice(1), "utf8");
  if (!spec || spec === "true") { console.error("--spec <text|@file> required"); process.exit(1); }
  const dir = f.dir && f.dir !== "true" ? f.dir : "tests";
  const prompt =
`You are an independent cross-vendor test author. Write a FIRST CUT of FAILING tests that pin the
acceptance criteria below, in this project's test framework, under ./${dir}. Tests must define
"done" by behavior (including failure/empty/edge cases) — do NOT write production code, only tests.

ACCEPTANCE CRITERIA / SPEC:
${spec.slice(0, 100000)}`;
  const r = spawnSync("codex", ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "-"],
    { input: prompt, encoding: "utf8", timeout: 8 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) { console.error(`codex exec failed: ${(r.stderr || "").slice(0, 500)}`); process.exit(FALLBACK); }
  console.log((r.stdout || "").trim());
  console.log("\n↪ tester: review, finalize, and OWN these tests, then `orchestrator tests-lock`.");
}

function main(): void {
  process.stdout.on("error", (e: NodeJS.ErrnoException) => { if (e.code === "EPIPE") process.exit(0); });
  const [cmd, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  switch (cmd) {
    case "detect": return cmdDetect(f);
    case "review": return cmdReview(f);
    case "test": return cmdTest(f);
    default:
      console.error("usage: codex <detect|review|test> [...]");
      process.exit(1);
  }
}
main();
