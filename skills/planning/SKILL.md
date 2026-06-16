---
name: planning
description: Use when planning a goal into work before building — i.e. whenever /tulpkit:plan runs, or when you need to decompose a non-trivial goal into a sorted, nested task tree and decide where each piece's spec lives (a task issue.md vs a project skill). Defines the clarify→decompose→classify→create→render process, the task-spec vs skill-spec decision rule, and the progressive-disclosure conventions that make project skills the living spec/knowledge layer.
---

# Planning

Turn a goal into a **sorted, nested task tree** — the backlog `/tulpkit:make` executes leaf by leaf.
Planning *defines and orders work*; it never implements. Keep the human in the loop: you produce a
reviewed plan, the user drives the build.

> **Why this shape.** Decomposition into small, independently-verifiable increments is the
> highest-yield lever on agent output (least-to-most / chain-of-thought). A plan is a re-enterable
> backlog, not a frozen waterfall doc — re-plan as you learn. Durable knowledge is promoted into
> **project skills** so the team's understanding compounds instead of rotting (preserve human
> understanding).

## The process (what /tulpkit:plan follows)

1. **Clarify** — ask questions **one at a time** (AskUserQuestion) to uncover *the real decision*,
   not just the stated task: the actual outcome wanted, the hard constraints, and what is explicitly
   out of scope. Stop when you can decompose with confidence — don't interrogate.
2. **Decompose** — break the goal into the **smallest independently-verifiable increments**. Each
   leaf must be deliverable and checkable on its own = exactly one `/make` run. Favor more, smaller
   leaves. A leaf that can't be verified alone is too big — split it.
3. **Classify** each piece with the decision rule below.
4. **Create** the tree: root task first, then one child per increment with `--parent`/`--order`,
   plus `--spec` and a `--tier` hint. Scaffold any skill-specs.
5. **Render & hand off** — `tasks.ts tree`, then point the user at `/make` per leaf, in order.

## Decision rule — where does the spec live?

| Signal | Spec home | How to create |
| --- | --- | --- |
| Atomic · no new durable concept · doesn't touch the overall design · verifiable on its own | **task-spec** = the task's own `issue.md` | `--spec task --tier quick` (default) |
| Design-affecting · introduces a durable concept · reused across tasks · changes architecture | **skill-spec** = a project skill at `.claude/skills/<name>/SKILL.md` | scaffold the skill, then `--spec skill:<name> --tier full` |

- **When unsure, prefer task-spec.** Promote to a skill-spec only when the knowledge will outlive the
  task and be reused. Over-skilling clutters the knowledge base.
- **Wiring the new reality.** A task that *changes* a durable reality sets `--spec skill:<name>` **and**
  carries an explicit acceptance-criteria line — "update the `<name>` skill-spec to reflect X" — so
  keeping the knowledge layer current is part of the definition-of-done, checked at sign-off.

## Why skills *are* the knowledge base (no retrieval engine needed)

A skill-spec is just a project-level Claude Code skill. Claude Code already **auto-discovers** skills
and **progressively loads** them on demand — so the project's `.claude/skills/` *is* the searchable,
retrievable spec/knowledge layer. `/make`'s `domain-researcher` reads matching skills in P0. Don't
build retrieval; write good skills.

## Nesting & tiers

- **Nesting** is a logical tree via `parent`/`order` frontmatter (folders stay flat). A plan = the
  subtree under its root task. View it with `tasks.ts tree [--task <root>]`.
- **`order`** sorts siblings (defaults to id). Number increments in delivery order.
- **`tier`** hint rides in the task frontmatter: atomic → `quick`, design-affecting → `full`. `/make`
  reads it to pick staffing. The four sign-off gates are identical either way.

## Skill-spec scaffold

When creating a skill-spec, `Write` `.claude/skills/<name>/SKILL.md`:

```markdown
---
name: <kebab-name>
description: Use when <situation this durable knowledge governs>. Covers <scope>.
---

# <Title>

## What this is / why it exists
<the durable reality this skill captures>

## Acceptance criteria (the spec)
- [ ] <criterion the work governed by this skill must satisfy>

## Constraints
<hard requirements, budgets, must-use libs>

## Out of scope
<what this explicitly does not cover>

## References
<links to code, docs, prior art — split detail into references/ for progressive disclosure>
```

Keep `SKILL.md` short; push depth into a `references/` folder so it loads only when needed.

## Non-negotiables

1. **Plan, don't build.** Planning ends at a reviewed backlog. Never auto-run the tree.
2. **Smallest verifiable increments.** Each leaf = one `/make` run, checkable alone.
3. **Prefer task-spec; promote deliberately.** Skill-specs are for durable, reused, design-affecting knowledge.
4. **Keep the knowledge layer current.** Design-affecting work includes updating its skill-spec.
