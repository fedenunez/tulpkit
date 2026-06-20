# Project memory (copy to your repo root)

## How we run non-trivial work
Run any non-trivial task with `/tulpkit:make <what you want>`. It runs a
staged multi-agent workflow and a Stop hook refuses to end the session until validation
passes and the reviewer signs off. Methodology lives in the `orchestrated-delivery` skill.

## Tasks
Track work in repo `tasks/` (cross-cutting) or a subproject's `tasks/` (scoped) with
`/tulpkit:add`, `/tulpkit:list`, `/tulpkit:make`, `/tulpkit:remove`. Schema: the `tasks` skill.

## Learnings — read before, append after
Before non-trivial work, read **LEARNINGS.md**; after any hard-won fix, append a
`symptom → cause → rule` entry so the next run inherits it.

## Specs
Durable specs live as skills. Treat the relevant skill as the source of truth; don't re-derive it.
