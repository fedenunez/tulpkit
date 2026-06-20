#!/usr/bin/env -S npx tsx
/**
 * enforce-signoff.ts — a Claude Code **Stop hook**.
 *
 * Wired in .claude/settings.json. It runs every time the main session tries to
 * end its turn. While an orchestration run is active and not signed off, it
 * returns {"decision":"block", reason} which Claude Code feeds back as
 * continuation instructions — so the workflow cannot quietly stop half-done.
 *
 * Reliability notes (verified against the Claude Code hooks reference):
 *  - On exit 0, Claude Code processes JSON on stdout. {"decision":"block"} +
 *    "reason" prevents stopping and tells Claude how to proceed.
 *  - `stop_hook_active` is true when we are already inside a hook-forced
 *    continuation; we still enforce, but a block_count safety valve prevents
 *    an infinite loop if the run genuinely can't progress.
 *  - Hooks defined in .claude/settings.json (not via a plugin) are the path
 *    that reliably continues on a Stop block.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const MAX_BLOCKS = 8; // safety valve: never trap the session forever

type SignOff = { approved_by: string; at: string; checklist: Record<string, string> };
type RunState = {
  task: string;
  status: "in_progress" | "complete" | "aborted";
  phases: { id: string; name: string; status: string }[];
  validation: { mode: "tdd" | "adapt" | "manual" | null; command: string | null; reason: string | null };
  test_runs: { cmd: string; passed: boolean }[];
  review_iterations: { n: number; issues_found: number; resolved: boolean }[];
  sign_off: SignOff | null;
  block_count: number;
};

function allow(): never {
  process.exit(0); // no JSON, no decision → Claude is free to stop
}

function block(reason: string): never {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0); // JSON is only honored on exit 0
}

async function readStdin(): Promise<any> {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function nextHint(s: RunState): string {
  const active = s.phases.find((p) => p.status === "active") ?? s.phases.find((p) => p.status === "pending");
  const last = s.review_iterations[s.review_iterations.length - 1];
  const openIssues = last && !last.resolved ? last.issues_found : 0;
  const v = s.validation;
  const lastTest = s.test_runs?.[s.test_runs.length - 1];
  const testsGreen = !!lastTest && lastTest.passed;
  const bits: string[] = [];
  if (active) bits.push(`advance ${active.id} (${active.name})`);
  if (!v?.mode) {
    bits.push(
      "decide how to validate first — run `npx tsx \${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.ts detect`, " +
        "then `orchestrator validation --mode tdd|adapt|manual …`; if the project's test setup is unclear, ASK THE USER",
    );
  } else if (v.mode === "manual") {
    bits.push(`validation is manual (${v.reason ?? "reason not recorded"}) — ensure the reason is recorded`);
  } else if (!testsGreen) {
    const cmd = v.command ? ` (\`${v.command}\`)` : "";
    bits.push(`get the ${v.mode} validation green${cmd}: run \`npx tsx \${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.ts test\` until it passes`);
  }
  if (openIssues > 0) bits.push(`resolve ${openIssues} open review issue(s) then re-run \`orchestrator review\``);
  if (!last) bits.push("once validated, hand to the code-reviewer subagent and record the result with `orchestrator review`");
  bits.push(
    "the run ends only when validation passes (or a recorded manual exception), the tester's locked tests are " +
      "intact (`orchestrator tests-verify`), and the code-reviewer (a different model than the implementer, or Codex " +
      "if available) records an auditable sign-off WITH a spec_conformance attestation via " +
      "`npx tsx \${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.ts signoff --by code-reviewer --check spec_conformance=\"…\" --check …`",
  );
  return bits.join("; ");
}

async function main(): Promise<void> {
  const input = await readStdin();
  const root = input.cwd || process.cwd();
  const stateFile = path.join(root, ".claude", "orchestrator", "run-state.json");

  let s: RunState | null = null;
  try {
    s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    allow(); // no run in flight → nothing to enforce
  }
  if (!s || s.status === "complete" || s.status === "aborted") allow();
  if (s!.sign_off) allow();

  // safety valve
  if ((s!.block_count ?? 0) >= MAX_BLOCKS) {
    process.stdout.write(
      JSON.stringify({
        systemMessage:
          `⚠ Orchestration still unsigned after ${MAX_BLOCKS} forced continuations. ` +
          `Releasing the stop guard to avoid a loop — run \`orchestrator status\` and finish or abort manually.`,
      }),
    );
    allow();
  }

  // record the block and force continuation
  s!.block_count = (s!.block_count ?? 0) + 1;
  try {
    fs.writeFileSync(stateFile, JSON.stringify(s, null, 2) + "\n");
  } catch {
    /* non-fatal */
  }

  block(
    `🚧 Orchestration run for "${s!.task}" is active and NOT signed off — do not stop. ` +
      `Continue the workflow: ${nextHint(s!)}. ` +
      `Check progress any time with \`npx tsx \${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.ts status\` ` +
      `(see /tulpkit:help gates for what must pass).`,
  );
}

main();
