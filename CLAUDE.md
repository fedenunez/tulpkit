# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`tulpkit` is a **Claude Code plugin** (not an application). There is no build/runtime — the
deliverable is the set of plugin primitives at the repo root: a manifest, slash commands, subagent
definitions, skills, a `Stop` hook, and four TypeScript scripts run via `npx tsx`. Editing this
repo means editing those primitives. The plugin ships two capabilities: **orchestrated delivery**
(`/tulpkit:make`) and a **git-backed folder task system** (`/add`, `/list`, `/remove`, `/make`).

> Distinguish two audiences: `examples/CLAUDE.md` and `examples/LEARNINGS.md` are templates **for
> downstream repos that install the plugin** — they are not this repo's own config. This file
> (root `CLAUDE.md`) is for working **on the plugin**.

## Commands

```bash
npm run typecheck        # tsc --noEmit — static gate; run after editing any script
npm test                 # tsx scripts/selftest.ts — executable gate: exercises all 4 scripts,
                         # the Stop-hook contract, the sign-off gates, and the plugin structure
npx tsx scripts/orchestrator.ts status     # inspect the active orchestration run
npx tsx scripts/orchestrator.ts <cmd> ...  # drive the state machine (see below)
npx tsx scripts/tasks.ts <new|move|remove|show|list|states|tree> ...
npx tsx scripts/codex.ts detect [--probe]  # is a cross-vendor Codex reviewer available?
```

**Both `npm run typecheck` and `npm test` are the verification gates** — run both after changing any
script. `selftest.ts` is the plugin practicing what it preaches: deterministic, dependency-free
assertions over the four scripts. Add a case to it for every gate/behavior you change. After
changing any `agents/`, `hooks/`, or skill files, the consuming session must restart or
`/reload-plugins` for changes to take effect.

## Architecture — orchestrated delivery

The design principle: **the main-session orchestrator owns the state machine; subagents do work and
report; the orchestrator records.** This keeps writes single-threaded and avoids relying on
`${CLAUDE_PLUGIN_ROOT}` inside subagent shells.

- **`scripts/orchestrator.ts`** is the deterministic state machine. It persists to
  `.claude/orchestrator/run-state.json` in the *consuming repo's* cwd (not this repo). Subcommands
  form the lifecycle: `init → detect → validation → phase → tests-lock → test → review → signoff`
  (`status`/`abort` are out-of-band). `init --tier full` uses `DEFAULT_PHASES` (P0–P4); `--tier
  quick` uses `QUICK_PHASES` (P0/P2/P4, the 3 gate-critical roles only). **Tier changes staffing,
  never the four sign-off gates** — both tiers enforce the identical floor. The orchestrator routes
  `auto` (the default): it picks the tier from the task description up front and records the decision
  (`init --tier <quick|full> --route auto --reason "…"`, stored in `routing`); a bare `--tier auto`
  safely falls back to `full`. Validation is command-agnostic — `detectValidation` suggests the
  team's existing test command across many ecosystems (a hint to confirm), and `validation --cmd`
  records whatever they actually run.
- **`scripts/enforce-signoff.ts`** is the `Stop` hook (wired in `hooks/hooks.json`). On every Stop
  it reads `run-state.json`; while a run is active and unsigned it returns
  `{"decision":"block", reason}` to force continuation, with a `MAX_BLOCKS = 8` safety valve. It
  emits JSON only on exit 0 — that's the contract Claude Code honors.
- **`scripts/codex.ts`** is an optional cross-vendor bridge to OpenAI's Codex CLI for the review
  (and optionally first-cut tests). Exit code **2** is meaningful: "Codex unusable → fall back to
  the in-session `code-reviewer` subagent." It is invoked over Bash by the orchestrator; there is
  no "Codex subagent."
- **`agents/`** — 5 core roles + 1 on-demand, each a subagent with a `model:` and preloaded
  `specialist-protocol` skill: `domain-researcher` (sonnet), `system-architect` (opus),
  `implementer` (sonnet), `tester` (sonnet), `code-reviewer` (**opus, deliberately ≠ implementer**),
  `ux-designer` (sonnet, on-demand).
- **`skills/orchestrated-delivery/`** is the methodology the `/make` command follows; its
  `prompt-template.md` and `signoff-checklist.md` are loaded on demand.

### The four sign-off gates (all enforced in `cmdSignoff`)

These are the core invariants — preserve them when editing `orchestrator.ts`:

1. **Executable validation** — a real green test run (CLI runs the command, checks exit 0) *or* a
   recorded `manual` reason. Policy is `tdd` / `adapt` / `manual`, decided in P1 via `detect`.
   `manual` is fenced (see `cmdValidation`/`cmdSignoff`): refused when `detectValidation` finds a
   test command (override only via `--despite-detected-tests`), reason has a length floor, no
   sign-off-time `--allow-no-tests` bypass exists, and a green→manual flip is rejected. These keep
   the finish-line (under Stop-hook pressure) from being an escape.
2. **Test integrity** — the tester locks test files (`tests-lock` stores sha256 hashes); if any
   locked test changed or was deleted by the time of sign-off, sign-off is refused. This exists
   because capable models game gates they can edit.
3. **Spec-conformance attestation** — sign-off requires a `--check spec_conformance="…"` item;
   "tests pass" is necessary, never sufficient.
4. **Auditable checklist** — ≥ `MIN_CHECKLIST_ITEMS` (4) non-empty checklist items and zero open
   review issues.

### Role separation invariant

The **tester** is the sole author of test files; the **implementer** must never create, edit,
weaken, or delete them. This is enforced socially (agent prompts + `specialist-protocol`) and
mechanically (hash-based test lock). The **reviewer differs from the implementer** by model
(opus vs sonnet) or vendor (Codex) — never let them collapse to the same model; self-preference
bias is the reason.

## Architecture — tasks system (`scripts/tasks.ts`)

Folder-based and git-backed. Source of truth is `tasks/list/{type}-{id}-{slug}/issue.md`; current
state is encoded by **one relative symlink** `tasks/by-state/{state}/{folder} -> ../../list/{folder}`,
and mirrored in `issue.md` frontmatter (`move` updates both). Runs at any `tasks/` root via `--root`
(repo root for cross-cutting work, a subproject for scoped work). `type` ∈ issue|task|feature
(bug = issue + `kind: bug`); `state` ∈ proposed·pending·inprogress·done·rft·rejected. IDs
auto-increment per root. Symlinks assume a POSIX filesystem.

## Conventions and gotchas

- **`${CLAUDE_PLUGIN_ROOT}`** expands reliably in **hooks** but has been flaky inside **slash-command
  bodies** in some Claude Code versions. Commands fall back to "locate the script" when it's unset;
  subagents never call the scripts directly (a reason the orchestrator owns the state machine).
- **Scripts are dependency-light** — Node built-ins only (`fs`, `path`, `crypto`, `child_process`),
  ESM (`"type": "module"`), strict TypeScript. Each parses its own `--flag value` args manually and
  guards against the `"true"` sentinel (a flag with no value). Keep this style; don't add runtime deps.
- **All scripts** install an `EPIPE` guard on stdout and use `spawnSync` for shelling out. Match
  these patterns when adding subcommands.
- The HTML files (`README.html`, `evidence.html`, `research.html`) are the public, evidence-backed
  rationale for design decisions — consult them before changing a gate or the role/model policy, and
  keep them in sync when the methodology changes.
- Per global instruction: **never use sleeps/delays to synchronize** — the design already uses the
  hook/state-file callback loop, not polling. Flag unfinished work with `FIXME:`.
