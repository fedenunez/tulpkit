# Design — tulpkit planning, hybrid specs, nested tasks & visual help

**Date:** 2026-06-16
**Status:** Implemented 2026-06-16 — all of C1–C4 **plus** follow-ons A and B shipped in this pass; `npm run typecheck` clean, `selftest.ts` 74/74 green.
**Origin:** Grounded findings from fact-checking the video *"Stop Prompting Claude. Use Karpathy's Method Instead."* (see `stop-prompting-analysis.md`). The validated science (decomposition B2, external/process verification B4/B6, RAG B7, constrained-decoding guardrails B9, self-preference bias / critic≠generator) is translated into concrete tulpkit capabilities.

## Scope

This spec covers the **C cluster** — the interlocking core — as one implementation effort:

- **C1** — Nested tasks (`tasks.ts`)
- **C2** — Hybrid spec model (task-spec vs skill-spec) + locked spec artifact (`orchestrator.ts`, `tasks.ts`)
- **C3** — `/tulpkit:plan` interactive command + planning skill
- **C4** — `/tulpkit:help` visual ASCII-art explainer

Two quick **follow-on** sub-projects are deferred to their own specs/PRs (not designed here):

- **A** — Add a "Scientific basis" section to `research.html` / `evidence.html` mapping each gate + role-separation to verified citations (Panickssery 2024, Huang 2024, Stechly 2024, Lightman 2023, PICARD, Du 2023). Docs-only.
- **B** — Multi-vote review (`--critics N`, majority vote) in `orchestrator.ts` + `code-reviewer.md`. Backed by multiagent-debate (Du et al. 2023).

**Codex decision (resolved, no work):** keep the homegrown `scripts/codex.ts` bridge; do *not* adopt the video's third-party "Codex plugin." Rationale: tulpkit's dependency-light principle (Node built-ins only), the exit-code-2 → in-session-reviewer fallback contract is ours, and any plugin is just a wrapper over the same `codex` CLI we already call. To run: install the `codex` CLI + `codex login` (or `CODEX_API_KEY`/`OPENAI_API_KEY`); `npx tsx scripts/codex.ts detect --probe` confirms usability and the orchestrator auto-routes the cross-vendor review.

---

## C1 — Nested tasks (approach A: logical tree via frontmatter)

Folders stay flat in `tasks/list/`; nesting is **metadata**, preserving the POSIX-symlink invariant the whole system rests on (`nextId`, `findFolder`, `by-state` relative symlinks, `move` — all untouched).

**Frontmatter additions** to `issue.md` (both optional; absent = root/unordered, so existing tasks are unaffected):
- `parent: <folder-name>` — the parent task's folder; absent/empty ⇒ root task.
- `order: <int>` — sort key among siblings; defaults to the task's `id` when omitted.

**`cmdNew`** gains `--parent <folder|id>` and `--order <n>`:
- `--parent` resolves through the existing `findFolder` (accepts id or folder name), errors if it doesn't exist, and writes `parent:`/`order:` into the frontmatter block.
- IDs remain global/flat (`nextId` unchanged).

**New `cmdTree`** — `tasks.ts tree [--task <root>] [--root .]`:
- Reads frontmatter across `list/`, builds the parent→children map, prints the indented tree sorted by `order` then `id`, each node annotated with `[state]` (read via the existing `currentState`).
- With `--task`, prints just that subtree. **A plan = the subtree under its root task.**

**`cmdRemove`** becomes child-aware: refuses to remove a task that still has children unless `--cascade` is passed (then removes the subtree). Prevents silent orphaning.

**Out of scope (YAGNI v1):** no auto-cascade on `move` (each task transitions its own state; `tree` shows the rollup); no `reparent` command — parent is set only at creation, so **cycles are structurally impossible** and need no validation. Add `reparent` + cycle-checking only if a real need appears.

---

## C2 — Hybrid spec model + locked spec artifact

**Two spec homes, declared in `issue.md` frontmatter via a new `spec:` field:**
- `spec: task` *(default)* — authoritative spec is the task's own `issue.md` (its existing structured Acceptance criteria / Constraints / Out-of-scope sections). For **atomic work that doesn't touch the overall design**.
- `spec: skill:<skill-name>` — authoritative spec is a **skill-spec**: a project-level Claude Code skill folder (progressive disclosure — `SKILL.md` + `references/`) in the *consuming repo's* `.claude/skills/<name>/`, holding durable, design-affecting knowledge. The task references it; the skill is the source of truth.

**Decision rule** (lives in the planning skill, applied by `/plan`):
- Design-affecting · introduces a durable concept · reused across tasks · changes architecture ⇒ **skill-spec**.
- Self-contained · no new durable concept · independently verifiable ⇒ **task-spec**.
- A task that *changes* a durable reality sets `spec: skill:<name>` **and** carries "update the skill-spec" as an explicit acceptance-criteria line — the "wire the new reality in" definition-of-done, made checkable.

**Locked spec artifact — mirrors `tests-lock` exactly:**
- `RunState.spec_lock: SpecLock | null`, where `SpecLock = { at: string; by: string; source: "task" | "skill"; files: Record<string,string> }` (sha256 per spec file).
- New command `orchestrator spec-lock --paths "<issue.md and/or skill files>"`, run at the end of P0/P1 once acceptance criteria are agreed — freezes the spec like the tester freezes tests. Reuses `resolveTestPaths` / `sha256`.
- New `verifySpecIntegrity()` parallel to `verifyIntegrity()`.

**Gate 3 upgrade (anti-gaming, backward-compatible):**
- *If a `spec_lock` exists*: sign-off refuses when the locked spec file(s) changed after lock — you cannot quietly relax acceptance criteria to make weak work "conform," exactly as you cannot edit locked tests. The free-text spec-conformance attestation stays *on top* (the reviewer attests *how* the build meets the **frozen** criteria).
- *If no `spec_lock`*: current behavior unchanged (free-text attestation only). Purely additive — existing runs and the `quick` tier still pass.

**Deliberately NOT a 5th universal gate:** "must update a skill" cannot be forced on every run — atomic tasks legitimately touch no skill. Knowledge-base wiring is enforced *conditionally* (only when a task declares `spec: skill:<name>`, via its acceptance criteria + an optional `--check knowledge_base="…"`). A hard conditional gate is a future option, not v1.

**#2C (knowledge base) collapses into this — no retrieval engine needed.** A skill-spec is a project-level Claude Code skill; Claude Code already auto-discovers and progressively loads skills on demand, so **the project's skills ARE the searchable, retrievable knowledge base.** We use the platform's skill discovery as the RAG layer rather than building one.

---

## C3 — `/tulpkit:plan` command + planning skill

**`commands/plan.md`** — `/tulpkit:plan <goal>` (`allowed-tools: Bash, Read, Edit, Write, AskUserQuestion` + the planning skill). Runs in the main session, so it can drive **AskUserQuestion** interactively. Flow:
1. **Clarify** — ask questions one at a time to uncover *the real decision*, not just the stated task.
2. **Decompose** — break the goal into the smallest independently-verifiable increments (least-to-most; each leaf = exactly one `/make` run).
3. **Classify each piece** — apply the C2 decision rule: design-affecting ⇒ skill-spec; atomic ⇒ task-spec.
4. **Create artifacts** — `tasks.ts new` for the root, then one child per increment with `--parent <root> --order N` (C1 nesting); scaffold any skill-specs in `.claude/skills/<name>/`.
5. **Render & hand off** — print `tasks.ts tree` as the sorted backlog; instruct "run `/tulpkit:make` on each leaf in order."

**`skills/planning/SKILL.md`** — methodology (progressive disclosure: short SKILL.md + `references/`): the decision rule, decomposition heuristics, the one-question-at-a-time interaction protocol, the skill-spec scaffold template, and the frontmatter conventions (`parent`, `order`, `spec:`).

**Integration touches:**
- `/plan` writes a `tier:` hint into each task's frontmatter — design-affecting (skill-spec) ⇒ `full`, atomic ⇒ `quick` — so `/make` picks staffing automatically.
- `/plan` only *creates* specs; the **spec-lock happens inside `/make`'s P0/P1** (C2). Clean separation: plan defines, make freezes-and-builds.

**Out of scope (YAGNI):** `/plan` does not auto-execute the tree; it produces the backlog and the human drives `/make` per leaf (preserves human-in-the-loop).

**Agile mapping:** `/plan` → sorted nested tree (backlog/WBS) → each leaf through `/make`'s four gates (small + verified increment) → durable outcomes promoted to skill-specs (living documentation). Re-enterable, not a frozen waterfall doc. This realizes the video's "small agile increments, not waterfall" — the strongest-supported claim (B2).

---

## C4 — `/tulpkit:help` (visual ASCII-art explainer)

**`commands/help.md`** — `/tulpkit:help [topic]` (`allowed-tools: Bash, Read`). Canonical ASCII diagrams live **statically in the command markdown** (not generated) for faithful, deterministic output; Claude prints the requested section verbatim. No new script.

**Trigger model: pull-only + breadcrumbs (decided).** The command shows *only* when the user types it (platform behavior — commands don't self-trigger). To aid discovery, existing output gains a single one-line pointer (never auto-dumping diagrams):
- `orchestrator init`/`status` output ends with `· tip: /tulpkit:help make`.
- the Stop-hook block `reason` appends `(see /tulpkit:help gates)` when it forces continuation.

**Topics** (no-arg ⇒ overview map + legend):

| Topic | ASCII content |
|---|---|
| overview | the two capabilities side by side: orchestrated delivery (`/make`) and plan+tasks (`/plan`,`/add`,`/list`) |
| `make` | state machine `init → detect → validation → P0…P4 → tests-lock → test → review⟲ → signoff`, with the Stop-hook loop as a back-edge |
| `gates` | the four gates as a checkpoint diagram (executable validation · test integrity · spec-conformance · auditable checklist) |
| `roles` | role/model map — researcher·architect·implementer·tester·**reviewer(opus≠impl)**·ux + Codex cross-vendor, with the self-preference-bias note |
| `tasks` | **how the whole tasks system works**: the on-disk model (`tasks/list/{type}-{id}-{slug}/issue.md` + the `by-state/{state}/ → ../../list/` relative symlinks), the lifecycle states and legal transitions (`proposed → pending → inprogress → done · rft · rejected`), the types (`issue`/`task`/`feature`, bug = issue+`kind:bug`), the commands (`/add`, `/list`, `move`, `remove`, `tree`), `--root` scoping (repo root vs subproject), and the C1 nesting (`parent`/`order`) shown as a worked nested-tree example |
| `plan` | `/plan → sorted tree → /make per leaf → promote durable knowledge to skill-spec`, the agile loop |
| `specs` | task-spec vs skill-spec decision rule + spec-lock |

**One dynamic touch:** for `help make` mid-run, the command reads `orchestrator status` to mark *where you are* in the state machine. Everything else is static art.

Overview-art reference:

```
            ┌──────────────────────── tulpkit ────────────────────────┐
            │                                                          │
   /plan ──▶│  PLAN ──▶ nested task tree ──▶ /make each leaf ──▶ ✔     │
            │            (skill-spec │ task-spec)        │             │
            │                                            ▼             │
            │                              ╔═══ 4 GATES ═══╗           │
            │                              ║ valid·integ·  ║──▶ SIGNOFF│
            │                              ║ spec·checklist║           │
            │                              ╚═══════════════╝           │
            └──────────────────────────────────────────────────────────┘
```

`help tasks` art reference:

```
  tasks/                              STATES (issue.md `state:` ⇄ by-state symlink)
  ├── list/                           proposed ─▶ pending ─▶ inprogress ─▶ done
  │   └── feature-0003-auth/                 │          │                  ├─▶ rft
  │       └── issue.md  (the spec)           └─▶ rejected ◀────────────────┘
  └── by-state/
      └── inprogress/
          └── feature-0003-auth ──▶ ../../list/feature-0003-auth   (relative symlink)

  nested tree (parent/order):                 commands:
  feature-0003-auth            [inprogress]     /add [proposal|task|bug|feature] <title>
   ├─ task-0004-login-form     [done]    ord 1   /list [--state]   ·   tree [--task]
   ├─ task-0005-session-store  [pending] ord 2   move --to <state> ·   remove [--cascade]
   └─ task-0006-oauth          [pending] ord 3   --root <subproject>   (scopes the tasks/ root)
```

---

## Files touched

| File | Change |
|---|---|
| `scripts/tasks.ts` | `--parent`/`--order` in `cmdNew`; new `cmdTree`; `--cascade` in `cmdRemove`; `parent`/`order`/`spec`/`tier` in the `issue.md` frontmatter template |
| `scripts/orchestrator.ts` | `spec_lock` in `RunState`; `cmdSpecLock`; `verifySpecIntegrity`; Gate-3 upgrade; `· tip:` breadcrumbs in init/status |
| `scripts/enforce-signoff.ts` | append `(see /tulpkit:help gates)` to the block reason |
| `commands/make.md` | read the optional `tier:` frontmatter hint from the task's `issue.md` to choose `init --tier quick|full` (falls back to current behavior when absent) |
| `commands/plan.md` | new `/tulpkit:plan` command |
| `commands/help.md` | new `/tulpkit:help` command (static ASCII) |
| `skills/planning/SKILL.md` (+ `references/`) | new planning methodology skill |
| `skills/orchestrated-delivery/SKILL.md` | reference the `spec-lock` step + hybrid spec model in P0/P1 |
| HTML (`research.html`/`evidence.html`) | **(follow-on A, separate PR)** scientific-basis citations |

## Verification

- `npm run typecheck` — the gate for all script changes.
- `scripts/selftest.ts` — extend with: nested-task create/tree/cascade-remove; `spec-lock` + integrity violation refusal at sign-off; backward-compat (no `spec_lock` ⇒ old behavior).
- Manual: `/tulpkit:plan` on a sample goal produces a correct nested tree + a scaffolded skill-spec; `/tulpkit:help` topics render.

## Invariants preserved (must not regress)

- The four sign-off gates and their identical floor across `quick`/`full` tiers.
- Role separation: tester sole test author; reviewer ≠ implementer (model/vendor).
- Dependency-light scripts (Node built-ins, ESM, manual `--flag value` parsing, EPIPE guard, `spawnSync`).
- POSIX-symlink task model (flat `list/`, relative `by-state` symlinks, global `nextId`).
- No sleeps/delays for synchronization.
