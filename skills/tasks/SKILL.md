---
name: tasks
description: Git-backed folder task system. Use whenever creating, moving, listing, or reasoning about tasks/issues/bugs/proposals tracked in the repo's tasks/ directories — including the /tulpkit:add, /list, /make, /remove commands.
---

# Tasks — schematic

Folder-based, git-backed. Root `tasks/` = work spanning **multiple** subprojects.
Each subproject has its **own** `tasks/` for work scoped to it alone.

```
tasks/
  list/{type}-{id}-{slug}/        # source of truth
      issue.md  [attachments...]  [specs.html when needed]
  by-state/{state}/{folder}       # relative symlink -> ../../list/{folder}
```

- `type`  : issue | task | feature   (bugs = issue with `kind: bug`)
- `id`    : zero-padded, auto-incremented per `tasks/` root
- `slug`  : ascii, lowercase, hyphens, no spaces
- `state` : proposed · pending · inprogress · done · rft · rejected
- one symlink per task = its current state. `issue.md` frontmatter mirrors it.

## Drive it (run at the right `tasks/` root via --root)

```
tasks.ts new  --type task --title "…" [--id N] [--state pending] [--kind bug] [--scope <name>]
tasks.ts move --task <folder|id> --to inprogress      # relinks + updates frontmatter
tasks.ts list [--state inprogress]
```
Script: `${CLAUDE_PLUGIN_ROOT}/scripts/tasks.ts` (TypeScript, via `npx tsx`).

## Commands
- `/tulpkit:add [proposal|task|bug|feature] <title>` — create (default `task`).
  Mapping: task→task/pending · bug→issue+bug/pending · feature→feature/pending ·
  proposal→feature/proposed · pending→task/pending.
- `/tulpkit:list [proposal|pending|in-progress|done]` — default `pending` + counters of all states.
- `/tulpkit:remove <slug|id>` — delete folder + symlink (git-recoverable).
- `/tulpkit:make <slug|id>` — run the orchestration on a task; auto-moves inprogress → done.

After `add`, fill `issue.md` (Context + Acceptance criteria). Commit the folder + symlink.

Script subcommands: `tasks.ts new|move|remove|show|list|states` (under `${CLAUDE_PLUGIN_ROOT}/scripts/`).
