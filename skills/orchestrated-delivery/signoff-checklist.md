# Auditable sign-off

Sign-off is the single exit from the review loop. It is refused by the state machine
unless it carries at least 4 non-empty checklist items, so it can never be an empty
stamp. Use the canonical four, plus task-specific ones.

## Canonical checks (always)
- `spec_conformance` — **required.** How the implementation meets the task's acceptance criteria,
  beyond tests passing. Sign-off is refused without it (green tests on weak tests are not "done").
- `test_integrity` — auto-filled from the lock: the tester's locked tests are intact (not
  weakened/deleted by the implementer). A violation refuses sign-off.
- `correctness`   — behavior verified against the cited authoritative source(s)
- `tests` / `validation` — auto-filled from the GATE: sign-off runs the policy's real test
  command and refuses without exit 0. For `manual` policy it carries the recorded reason
  instead. Add coverage notes here too.
- `integration`   — drops into the real setup / replaces the ad-hoc thing cleanly
- `error_handling`— failure, loading, and empty states handled deliberately

## Add for design / UI / design-system tasks
- `accessibility` — WCAG 2.2 AA contrast, focus order, keyboard nav, target sizes (cite the criteria)
- `consistency`   — design tokens used everywhere, no hardcoded values
- `responsive`    — verified at mobile / tablet / desktop

## Add for API / integration tasks
- `shapes`        — request/response shapes, status values, error codes match the docs
- `injectability` — usable as a drop-in in the existing setup

Command:
```
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.ts signoff --by code-reviewer \
  --check correctness="…" --check tests="…" \
  --check integration="…" --check error_handling="…" \
  --check accessibility="…"   # task-specific extras as needed
```

Four hard gates, all enforced by the state machine: **passing validation**, **intact locked
tests** (integrity — the gate wasn't gamed), a **spec-conformance attestation**, and **zero open
review issues** (`orchestrator review --issues 0 --resolved true`). Validation adapts to the
run's policy — `tdd`/`adapt` need a real green run (the CLI executes the command and checks
exit 0); `manual` needs a recorded reason. The policy itself must be set first
(`orchestrator detect` → `validation --mode …`, asking the user when the setup is unclear).
