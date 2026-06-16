# LEARNINGS

Append-only. Newest first. One entry per hard-won lesson.

Format:
## <date> · <short title>
**Symptom:** what went wrong / was observed
**Cause:**   the underlying reason
**Rule:**    the thing to do (or never do) next time

---

## 2026-06-16 · Stop-hook continuation must have a safety valve
**Symptom:** A Stop hook that always blocks until sign-off can trap a session in a loop
if the run genuinely can't progress.
**Cause:**   No upper bound on forced continuations.
**Rule:**    Track a block_count in run-state and release the guard after a max (8),
emitting a systemMessage, so enforcement never becomes an infinite loop.

## 2026-06-16 · Sign-off must be un-fakeable
**Symptom:** "Approved" with no substance ends the loop early.
**Cause:**   Sign-off accepted any input.
**Rule:**    The state machine refuses sign-off without ≥4 non-empty checklist items and
zero open review issues. Approval is an audit record, not a stamp.
