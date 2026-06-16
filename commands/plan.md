---
description: Interactively plan a goal into a sorted, nested task tree — deciding per piece whether its spec lives in the task (atomic) or in a project skill (design-affecting). Produces the backlog that /tulpkit:make executes leaf by leaf.
argument-hint: <goal to plan>
allowed-tools: Bash, Read, Edit, Write, AskUserQuestion, Skill
---
# Plan: $ARGUMENTS

Load the `planning` skill and follow it exactly. The job is to turn "$ARGUMENTS" into a **sorted,
nested task tree** — *not* to implement anything. Keep the human in the loop.

`TASKS="npx tsx \"${CLAUDE_PLUGIN_ROOT}/scripts/tasks.ts\""` (if `${CLAUDE_PLUGIN_ROOT}` is unset,
locate this plugin's `scripts/tasks.ts` and use it). Append `--root <subproject>` to scope the plan
to a subproject's `tasks/`.

1. **Clarify** — use **AskUserQuestion**, one question at a time, to uncover *the real decision*
   behind the goal (not just the stated task): the actual outcome, the hard constraints, what's
   explicitly out of scope. Stop asking once you can decompose with confidence.

2. **Decompose** — break the goal into the **smallest independently-verifiable increments**. Each
   leaf must be deliverable and checkable on its own = exactly one `/tulpkit:make` run. Prefer more,
   smaller leaves over a few big ones (decomposition is the highest-yield lever).

3. **Classify each piece** (the planning skill holds the full rule):
   - **task-spec** (atomic, no new durable concept, doesn't touch the overall design) → the task's
     own `issue.md` is the spec. Create with `--spec task` (the default) and `--tier quick`.
   - **skill-spec** (design-affecting · introduces a durable concept · reused across tasks · changes
     architecture) → the authoritative spec is a **project skill** at
     `.claude/skills/<name>/SKILL.md` (progressive disclosure). Scaffold it, then create the task
     with `--spec skill:<name>` and `--tier full`. If a task *changes* that durable reality, add an
     explicit acceptance-criteria line: "update the `<name>` skill-spec to reflect the new reality."

4. **Create the tree** — make the root first, then one child per increment, wiring nesting + order:
   ```
   $TASKS new --as feature --title "<root goal>"
   $TASKS new --as task --title "<increment>" --parent <root-folder|id> --order 1 --spec task --tier quick
   $TASKS new --as feature --title "<design-affecting piece>" --parent <root-folder|id> --order 2 --spec skill:<name> --tier full
   ```
   For each skill-spec, `Write` `.claude/skills/<name>/SKILL.md` from the planning skill's scaffold.

5. **Render & hand off** — print the backlog and the next step:
   ```
   $TASKS tree
   ```
   Then tell the user: run `/tulpkit:make <leaf-slug>` on each leaf **in order**; `/make` reads each
   task's `tier:` hint automatically, freezes its spec with `orchestrator spec-lock`, and drives the
   gated build. Remind them to commit the new `tasks/list/...` folders, `by-state` symlinks, and any
   `.claude/skills/...` they created.

Do **not** auto-run the tree. Planning ends at a reviewed backlog; the user drives `/make` per leaf.
