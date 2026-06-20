---
description: List tasks. Default shows pending in detail plus counters for every other state.
argument-hint: "[proposal|pending|in-progress|done]"
allowed-tools: Bash
---
# List tasks ($ARGUMENTS)

Run (pass `$ARGUMENTS` as `--state` when it names a category — `proposal`→proposed,
`in-progress`→inprogress; with no arg it defaults to **pending**):
`npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/tasks.ts" list ${ARGUMENTS:+--state "$ARGUMENTS"}`
(if `${CLAUDE_PLUGIN_ROOT}` is unset, locate this plugin's `scripts/tasks.ts` and use it.)

The script prints the chosen state's tasks in detail followed by a one-line **counter summary**
of all states. Present it clearly; offer `/tulpkit:make <slug>` to start one.
