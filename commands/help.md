---
description: Visual, ASCII-art explainer of how tulpkit works — orchestrated delivery, the four gates, roles/models, the tasks system, planning, and specs. Optional topic narrows it (make|gates|roles|tasks|plan|specs).
argument-hint: "[make|gates|roles|tasks|plan|specs]"
allowed-tools: Bash, Read
---
# tulpkit help: $ARGUMENTS

Print the section(s) below that match "$ARGUMENTS" **verbatim** (the ASCII diagrams are canonical —
reproduce them exactly, don't paraphrase). If "$ARGUMENTS" is empty or unrecognized, print **Overview**
plus the topic legend. After the diagram, add 2–4 lines of plain explanation in your own words.

For `make` (or empty) **when a run is active**, also run
`npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.ts" status` and note which phase/gate the run is
at, so the diagram is anchored to the live state. Otherwise print only the static art.

---

## Overview  ·  (also shown for no argument)

```
        ┌──────────────────────────── tulpkit ────────────────────────────┐
        │  a Claude Code plugin: plan work, then deliver it through gates  │
        │                                                                  │
   /plan│   PLAN ──▶ sorted nested task tree ──▶ /make each leaf ──▶ ✔     │
   /add │            (task-spec │ skill-spec)            │                 │
   /list│                                                ▼                 │
        │                                  ╔═════ 4 GATES ═════╗           │
        │                                  ║ validation        ║           │
        │   /make ────────────────────────▶║ test-integrity    ║──▶ SIGNOFF│
        │                                  ║ spec-conformance  ║           │
        │                                  ║ auditable check   ║           │
        │                                  ╚═══════════════════╝           │
        └──────────────────────────────────────────────────────────────────┘

   topics:  /tulpkit:help make   gates   roles   tasks   plan   specs
```

Two capabilities: a **git-backed task system** (`/add`, `/list`, plan trees) and **orchestrated
delivery** (`/make`) that runs a task through a small specialist team and four hard sign-off gates.

---

## make  ·  the orchestrated-delivery state machine

```
  init ─▶ detect ─▶ validation ─▶ P0 ─▶ P1 ─▶ P2 ─▶ P3 ─▶ P4 ─▶ signoff ─▶ ✔ stop allowed
   │       (test     (tdd/adapt/   brief research build integ review                  ▲
   │        cmd?)     manual)       │     +arch  │            │                       │
   │                              spec-lock   tests-lock      │                       │
   │                              (freeze     (freeze tests)  │                       │
   │                               criteria)                  ▼                       │
   │                                                   ┌─ reviewer finds issues ─┐    │
   │                                                   │  implementer fixes them │    │
   │                                                   └──────────⟲──────────────┘    │
   │                                                        (loop to zero issues)      │
   └──────────────◀── Stop hook: while unsigned, blocks stop & re-injects ────────────┘
                       "keep working" (MAX_BLOCKS safety valve)
```

The main session owns the state machine (`orchestrator.ts`); subagents do work and report. The
**Stop hook** refuses to let the turn end until the run is signed off — so work can't quietly stop
half-done. `quick` tier collapses to P0·P2·P4; the four gates are identical in both tiers.

---

## gates  ·  the four sign-off gates (identical in quick & full)

```
   ┌─ 1. EXECUTABLE VALIDATION ─┐   a real green test run (exit 0) — or a recorded
   │  green ≠ proof, but required│   `manual` reason (fenced: refused when tests exist)
   ├─ 2. TEST INTEGRITY ────────┤   tester's locked tests (sha256) unchanged at signoff
   │  capable models game gates  │   — implementer may never edit/weaken/delete tests
   ├─ 3. SPEC-CONFORMANCE ──────┤   attest HOW the impl meets acceptance criteria;
   │  "tests pass" ≠ "done"      │   if spec was locked, frozen criteria must be intact
   └─ 4. AUDITABLE CHECKLIST ───┘   ≥ 4 non-empty checklist items + zero open review issues
                  │
                  ▼
            SIGN-OFF recorded ──▶ Stop hook releases the session
```

All four are enforced mechanically in `cmdSignoff`. There is no `--allow-no-tests` bypass and no
green→manual flip. Tiers change *staffing*, never this floor.

---

## roles  ·  the specialist roster (5 core + 1 on-demand)

```
   domain-researcher  (sonnet)  prior art, constraints — cites external facts
   system-architect   (opus)    structure, interfaces, the key tradeoff (ADR)
   implementer        (sonnet)  the code — NEVER writes or edits tests
   tester             (sonnet)  SOLE author of tests; writes & LOCKS them
   code-reviewer      (opus)    ◀── reviewer ≠ implementer ON PURPOSE
   ux-designer        (sonnet)  on-demand: UI / flows / a11y
                       │
                       └─▶ self-preference bias: a model flatters its own work,
                           so the reviewer differs by MODEL (opus≠sonnet) or
                           VENDOR (Codex, when installed) — strongest independence.
```

A well-structured team of medium models + an independent reviewer beats one big solo model. Codex,
if present, runs the cross-vendor review; otherwise the in-session opus reviewer does.

---

## tasks  ·  the git-backed, folder-based task system

```
  tasks/                              STATES (issue.md `state:` ⇄ by-state symlink)
  ├── list/                           proposed ─▶ pending ─▶ inprogress ─▶ done
  │   └── feature-0003-auth/                 │          │                  ├─▶ rft
  │       └── issue.md  (THE SPEC)           └─▶ rejected ◀────────────────┘
  └── by-state/
      └── inprogress/
          └── feature-0003-auth ──▶ ../../list/feature-0003-auth   (relative symlink)

  types:  issue · task · feature      (bug = issue + kind:bug)
  ids:    auto-increment per root      scope:  --root <subproject> picks the tasks/ root

  nested tree (parent/order):            commands:
  feature-0003-auth          [inprogress]  /add [proposal|task|bug|feature] <title>
   ├─ task-0004-login-form    [done]   ord1  /list [--state] · tree [--task] · show
   ├─ task-0005-session-store [pending]ord2  move --to <state>
   └─ task-0006-oauth         [pending]ord3  remove [--cascade]   (--cascade: whole subtree)
```

Source of truth is each `issue.md`; current state is one relative symlink under `by-state/` plus the
`state:` frontmatter (kept in sync by `move`). Nesting is logical (a `parent`/`order` field) so the
flat-folder/symlink model is untouched. A **plan** is just the subtree under a root task.

---

## plan  ·  /tulpkit:plan → backlog → /make (the agile loop)

```
  /plan <goal>
     │  clarify (one Q at a time)  →  decompose into smallest verifiable increments
     ▼
   classify each piece ─┬─ atomic, no design impact ─▶ TASK-SPEC  (issue.md)      tier:quick
                        └─ design-affecting/reused  ─▶ SKILL-SPEC (.claude/skills) tier:full
     │
     ▼
   sorted nested task tree  ──▶  /make each leaf, in order  ──▶  ✔ per leaf
     ▲                                   │
     └─── re-plan as you learn ◀─── promote durable knowledge into skill-specs
                                         (the knowledge base grows; not a frozen waterfall spec)
```

Each leaf is a small increment that flows through `/make`'s four gates independently — that's agile,
made mechanical. `/plan` only *creates* the backlog; you drive `/make` per leaf (human-in-the-loop).

---

## specs  ·  task-spec vs skill-spec, and the spec lock

```
  WHERE does the authoritative spec live?
  ┌─ atomic, self-contained, no new durable concept ─▶ TASK-SPEC
  │     = the task's own issue.md (Acceptance criteria / Constraints / Out-of-scope)
  └─ design-affecting · durable · reused across tasks ─▶ SKILL-SPEC
        = a project skill at .claude/skills/<name>/   (progressive disclosure = the knowledge base)

  SPEC LOCK (mirrors test-lock):  P0/P1 ─▶ orchestrator spec-lock --paths "<spec files>"
     freezes the acceptance criteria (sha256)  ─▶  at signoff, a changed/deleted spec file is
     REFUSED — you can't quietly relax the spec to make weak work "conform".
     (No lock recorded ⇒ the free-text spec-conformance attestation alone applies.)
```

Claude Code auto-discovers and progressively loads skills, so project skills *are* the retrievable
spec/knowledge layer — no separate retrieval engine needed.
