---
name: orchestrated-delivery
description: Use whenever a task should be run as a staged, multi-agent delivery rather than done ad hoc — i.e. any non-trivial build, feature, refactor, or design task, and always when the /tulpkit:make command runs. Defines the small specialist roster, the brief-first phase model, the verify-don't-trust-memory rule, the cross-model review, and the review loop that must reach an auditable sign-off before the work is considered done.
---

# Orchestrated delivery

Run the task as a small team of senior specialists, gated by phases, ending in a review loop
that cannot stop before an auditable sign-off. You (the orchestrator) plan, delegate, and
integrate — you do not personally do work a specialist should own. **Writes stay
single-threaded** (one implementer); extra agents add judgment, not parallel edits.

> Grounded in current evidence: a small role team with a review loop is what wins on frontier
> models; context assembly is the biggest single lever; reviewers must differ from authors
> (self-preference bias); and validation gates get *gamed* by capable models, so green is
> necessary, never sufficient.

## Operating philosophy (state it in every brief)

**This is a knowledge game, not a brute-force game.** You and every persona you summon ground
actions in **facts** — from the code, the docs, the user's project, or the internet — and never
guess. Problems are **isolated to their real origin** and fixed at the cause, not thrashed at with
random changes. The team **records hard-won learnings** (`LEARNINGS.md`, `symptom → cause → rule`)
so it gets wiser every run, and reads them before starting. This is the opening of the
`specialist-protocol` that every agent preloads — **restate it explicitly in the brief** (P0) so no
persona can miss it, and hold every persona to it: anything empirical is a *claim* to be grounded,
not a fact to be asserted.

## The roster (5 core + 1 on-demand, in `agents/`)

| Stage | Agent | Model | Owns |
| --- | --- | --- | --- |
| Research + verify | `domain-researcher` | sonnet | Prior art, constraints, the right approach — **cites external facts as it goes** |
| Architecture | `system-architect` | opus | Structure, interfaces, the key tradeoff calls (ADR) |
| Build | `implementer` | sonnet | The implementation — **never writes or edits tests** |
| Test | `tester` | sonnet | Sole author of tests; writes & **locks** them; owns the executable gate |
| Review | `code-reviewer` | **opus (≠ implementer)** | Verifies external+internal claims, spec-conformance, test integrity; loops to sign-off |
| Design *(on-demand)* | `ux-designer` | sonnet | UI/design tasks only — summon for flows/IA/a11y/visual work |

**Model policy (deliberate):** medium models (sonnet) do the bulk of the work; the two roles
that most need reasoning and independence — the architect and the reviewer — run on opus. A
well-structured team of medium models beats one big solo model; the reviewer differs from the
implementer on purpose.

## Tiers — scale the team, never the gates

`orchestrator init --tier quick|full` (default `full`). The choice changes **staffing and
ceremony only**; the four sign-off gates are byte-for-byte identical in both.

- **`full`** (default, non-trivial work): the whole roster and all five phases below.
- **`quick`** (small, single-file, tightly-coupled change): only the three **gate-critical** roles
  run — `tester` (authors & locks), `implementer` (passes), `code-reviewer` (≠ implementer) —
  across a collapsed P0 → P2 → P4. No separate `domain-researcher`/`system-architect`. The
  test-integrity lock and reviewer-≠-author invariants are fully preserved, so green still isn't
  self-certified. Use this instead of skipping the orchestration for "small" tasks.

Multi-agent fan-out is overkill for small/coupled work — `quick` is the honest answer, not abandoning the gates.

**Auto-routing (the default).** You (the orchestrator) choose the tier from the task description
*before* the run — a routing decision made once, up front, recorded for audit, and not re-litigated
mid-run. Record it: `init --tier <quick|full> --route auto --reason "<why>"` (a bare `--tier auto`
falls back to `full` so auto can never silently under-staff). **Escalate to `full`** when the task
touches shared interfaces / state machines / auth / billing / migrations / runtime behavior, spans
multiple modules, changes a durable abstraction, carries rollback or compatibility risk, enters an
unfamiliar domain, or has unclear acceptance criteria; otherwise `quick`. Bias to `full` when
uncertain, and **ask the user** before a routing choice that materially increases cost/time. Routing
only ever changes staffing — it can never lower a gate.

## Phases (strict — do not merge or skip)

- **P0 · Assemble the brief.** *Before any fan-out*, compile ONE canonical brief: the relevant
  specs-as-skills, the project's conventions, the matching `LEARNINGS.md` entries, and the
  task's acceptance criteria. Context assembly is the highest-ROI lever — don't fan out until
  the brief is complete. Mark it: `orchestrator phase P0 done`.
- **P1 · Research + architecture.** `domain-researcher` (citing external facts against official
  docs) + `system-architect` produce the approach and an ADR. Design tasks add `ux-designer`.
  **Decide the validation policy here:** run `orchestrator detect`, set `tdd`/`adapt`/`manual`,
  ask the user if unclear. **Use the team's OWN test command** — this workflow runs in any repo,
  so validate with whatever the project already uses (detect covers Node/pnpm, Python, Go, Rust,
  JVM, .NET, Elixir, Make/just/Task, …). `detect` only *suggests*; confirm it matches what they
  actually run (CI / CONTRIBUTING / Makefile) and record it verbatim with `--cmd`. Never assume `npm`. **Freeze the spec here too:** once acceptance criteria are settled, run
  `orchestrator spec-lock --paths "…"` to lock them — the task's `issue.md` for a `spec: task`
  item, or the `.claude/skills/<name>/` files for a `spec: skill:<name>` item. A locked spec that
  is changed by sign-off is refused, exactly like the test lock — you can't relax the criteria to
  make weak work conform.
- **P2 · Build with validation.** The **tester** writes the tests that define "done" and **locks**
  them (`orchestrator tests-lock --paths "…"`). The **implementer** then writes production code
  to pass them — and must never touch the tests. Record real runs with `orchestrator test`.
- **P3 · Integration.** Apply the work across the codebase; fix wiring so the result is coherent.
- **P4 · Review loop.** `code-reviewer` (a different model than the implementer) reviews →
  implementer fixes **every** issue → review again, until zero open issues, then sign off.
  Prefer a cross-vendor review when available (below). For high-stakes work, run an **N-critic
  panel** — several independent reviewers (varied model/vendor, each told to *refute*) — record it
  with `orchestrator review --critics N`, and require it at sign-off with `signoff --min-critics N`.
  Independent critics catch what one reviewer misses.

Mark transitions: `npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.ts phase <P0..P4> <active|done>`.

> **Who runs the state machine:** the orchestrator (main session) owns every `orchestrator.ts`
> call — `init/detect/validation/phase/tests-lock/tests-verify/spec-lock/spec-verify/test/review/signoff`.
> Subagents do the work and *report*; the orchestrator records.

## Cross-model & cross-vendor independence

Self-preference bias is strongest *within a model family*, so the most independent check is a
different vendor. For the **review** (and optionally the **tests**), prefer Codex when present:

```
# is Codex installed AND logged in? (checked by code)
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/codex.ts detect          # exit 0 = usable, 1 = not
```
- **Available →** run the independent cross-vendor review and feed its verdict to `code-reviewer`
  to reconcile: `npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/codex.ts review --base <merge-base>`.
  Optionally let Codex author the first cut of tests: `codex.ts test --spec @<acceptance.md>`
  (the `tester` still reviews, owns, and locks them).
- **Not available →** fall back to the in-session `code-reviewer` subagent, which already runs on
  a **different Claude model** (opus) than the implementer (sonnet).

Either way the reviewer ≠ the author. Codex is an external CLI, so the orchestrator invokes it
over Bash; there is no "Codex subagent" — it's a conditional bridge, summoned from this skill.

## Craft vs. claims (every specialist runs this)

Every specialist follows the shared `specialist-protocol` skill: GENERATE-mode agents (research,
architecture, design, build, tests) run hot and own their *craft*, but emit a `CLAIMS` block for
anything empirical instead of self-certifying it. As orchestrator, route those claims to the
**`code-reviewer`** (which now absorbs external + internal verification) — or to the cross-vendor
Codex review when available. Makers stay confident; the verifier stays neutral; nothing factual
is graded by the agent that produced it, and nothing is graded by the same model that wrote it.

## Non-negotiables

1. **Brief before fan-out.** P0 assembles context first — it's the biggest lever.
2. **Ask the stack before implementing.** Match the project's language, framework, conventions.
3. **Don't trust memory for external facts.** APIs, versions, standards, error/status codes,
   field shapes — verify against the authoritative doc and cite the page.
4. **The tester owns tests; the implementer never touches them.** Tests get locked; integrity is
   checked at sign-off. Agents that grade their own tests game them.
5. **Validate by code, but treat green as necessary — not proof.** Sign-off runs a real green
   run *and* checks test integrity *and* requires a spec-conformance attestation. Style adapts
   (`tdd`/`adapt`/`manual`) but the gate is never just "tests pass." **`manual` is not an escape
   hatch:** it's refused when a test runner is detectable (use `adapt`; override only with an
   audited `--despite-detected-tests "<why it can't run here>"`), it must be declared up front in
   P1 (there is no sign-off-time bypass), and you cannot go green and then flip to manual.
6. **Reviewer ≠ author** — cross-vendor (Codex) when available, else a different Claude model.

## Composing the great prompt

Turn the user's one-liner into a precise, phased brief that names the agents per stage. The full
template is in `prompt-template.md` — load it when you build the brief.

## Sign-off

Record it only when the reviewer truly approves — note the new required `spec_conformance` check:

```
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.ts signoff --by code-reviewer \
  --check spec_conformance="…how the impl meets the acceptance criteria, beyond tests passing…" \
  --check correctness="…verified against <source>…" \
  --check tests="…coverage incl. failure/empty cases…" \
  --check integration="…drops into the real setup…" \
  --check error_handling="…states covered…"
```

The state machine refuses sign-off without: a real green run (or recorded `manual` reason),
**intact locked tests**, a **spec-conformance** attestation, ≥4 checklist items, and zero open
issues. The Stop hook keeps the session running until this lands. See `signoff-checklist.md`.
