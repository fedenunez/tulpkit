---
description: Add a new task to the repo's folder task system. First word optionally sets the category (default task).
argument-hint: "[proposal|task|bug|feature] <title>"
allowed-tools: Bash, Read, Edit
---
# Add: $ARGUMENTS

If the first word of "$ARGUMENTS" is one of `proposal | pending | task | bug | feature`, use it
as the **category** and the rest as the **title**; otherwise the whole text is the title and
category = `task`. (Append `--root <subproject>` to file under a subproject's `tasks/`.)

Run:
`npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/tasks.ts" new --as <category> --title "<title>"`
(if `${CLAUDE_PLUGIN_ROOT}` is unset, locate this plugin's `scripts/tasks.ts` and use it.)

Category mapping: `task`→task/pending · `bug`→issue+bug/pending · `feature`→feature/pending ·
`proposal`→feature/proposed · `pending`→task/pending.

Then open the created `issue.md` and draft a tight **Context** + **Acceptance criteria**. Report
the folder name and remind the user to commit the `tasks/list/...` folder and its `by-state` symlink.
