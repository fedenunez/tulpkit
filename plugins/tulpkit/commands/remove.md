---
description: Remove a task from the folder task system (deletes its folder + state symlink; recoverable via git).
argument-hint: <task-slug | id>
allowed-tools: Bash
---
# Remove: $ARGUMENTS

Confirm the target with the user, then run:
`npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/tasks.ts" remove --task "$ARGUMENTS"`
(if `${CLAUDE_PLUGIN_ROOT}` is unset, locate this plugin's `scripts/tasks.ts` and use it.)

It deletes `tasks/list/<folder>` and the `by-state` symlink. Note it's recoverable from git
history, and remind the user to commit the deletion.
