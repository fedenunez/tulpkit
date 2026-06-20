# Great-prompt template

Fill the slots and present this to the user before fanning out.

```
Fan out senior subagents to architect, implement, and review the following task.

Task: <one-paragraph restatement of $ARGUMENTS, sharpened into a concrete goal>

Grounding (applies to everyone, every phase): this is a knowledge game, not a brute-force
game. Ground every decision in FACTS — the code, the docs, the user's project, or official
sources online — and never guess. Don't thrash random fixes: isolate each problem to its
real root cause and fix the cause, not the symptom. Read the matching LEARNINGS.md before
starting and append new symptom → cause → rule entries as you learn.

Work in STRICT PHASES — do not merge or skip:
  P1 · Research + architecture   → domain-researcher, system-architect[, ux-designer]
  P2 · Implementation            → implementer, tester
  P3 · Integration               → apply across the codebase, fix wiring/navigation
  P4 · Review loop               → code-reviewer ⟲ implementer, until sign-off

Requirements:
  - <the real, specific requirements derived from the task>
  - Match the project's existing stack and conventions.

Accuracy: verify every external dependency, API shape, version, standard, and error
code against its OFFICIAL documentation online — do not rely on memory. Cite the
specific doc page for each. (fact-checker-external) Separately cross-check the team's
internal assumptions and invariants. (fact-checker-internal)

Review loop: hand the code to the code-reviewer subagent. Iterate implementer ⟲
reviewer, fixing EVERY issue raised, and repeat until the reviewer explicitly signs
off. Do not stop early. The sign-off must list what was checked so approval is
auditable.

Deliverables:
  - Architecture decision (ADR) with rationale.
  - The implementation.
  - A test suite proving it, incl. failure/empty cases, plus one example of real use.
  - The reviewer's final sign-off with the verification checklist.

Before implementing, confirm the stack (language / framework / conventions) so the
work matches it.
```

Adapt the roster line per task: drop `ux-designer` for pure backend work; for a
UI/design-system task, P1 is design-language-first and may itself produce a skill.
