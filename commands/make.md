---
description: Run a task through the full staged, validation-gated multi-agent orchestration. Accepts a free-text description OR an existing task slug/id.
argument-hint: <task description | task-slug>
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Agent, Skill, WebSearch, WebFetch
---
# Make it happen: $ARGUMENTS

**Resolve the target first.** Check whether "$ARGUMENTS" names an existing task:
`npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/tasks.ts" show --task "$ARGUMENTS"`
(if `${CLAUDE_PLUGIN_ROOT}` is unset, locate this plugin's `scripts/tasks.ts` and use it).
- **Found** → read its `issue.md` as the spec and move it in progress:
  `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/tasks.ts" move --task "$ARGUMENTS" --to inprogress`
  Note its frontmatter hints: `tier:` (staffing) and `spec:` — `task` means the `issue.md` *is* the
  spec; `skill:<name>` means the authoritative spec is the project skill `.claude/skills/<name>/`
  (read it as part of the brief, and freeze its files at spec-lock).
- **Not found** → treat "$ARGUMENTS" as a new ad-hoc task description.

**Pick the tier.** If "$ARGUMENTS" begins with the word `quick` or `full`, that's the tier (strip
it from the spec). Else, if the resolved task carries a `tier:` frontmatter hint (set by
`/tulpkit:plan`), use it. Otherwise choose: **`quick`** for a small, single-file, tightly-coupled
change (runs tester + implementer + reviewer only); **`full`** (default) for anything non-trivial
(adds research + architecture). The four sign-off gates are identical either way — tier changes
staffing, never the floor. When in doubt, ask the user or default to `full`.

**Then orchestrate** — load the `orchestrated-delivery` skill and follow it exactly:
1. Boot: `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.ts" init --task "<the spec>" --tier <quick|full>`.
2. Clarify the stack if unclear; compose the phased multi-agent brief; fan out by phase. Once the
   acceptance criteria are agreed (end of P0/P1), **freeze the spec**:
   `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.ts" spec-lock --paths "<the issue.md and/or the skill-spec files>"`
   so the criteria can't be quietly relaxed later (checked at sign-off, like the test lock).
3. Decide the validation policy (`orchestrator detect` → ask the user if unclear); build; run
   the reviewer ⟲ implementer loop. The Stop hook keeps the session going until validation
   passes **and** the reviewer signs off.

**On sign-off**, if this was an existing task, close it:
`npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/tasks.ts" move --task "$ARGUMENTS" --to done`.
Capture any hard-won lessons in `LEARNINGS.md`.
