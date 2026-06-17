# tulpkit Review

## Findings

### High: Sign-off does not require a recorded review

`scripts/orchestrator.ts` allows sign-off when no review iteration exists. `openReviewIssues()`
returns `-1` if there is no review, and `cmdSignoff()` only rejects `open > 0`.

Impact: a run can be signed off with green validation plus checklist items but no recorded
`orchestrator review` iteration, even though `/tulpkit:make` says the reviewer signs off.

Recommendation: require at least one final review iteration with `resolved=true` before sign-off.

Relevant code:
- `scripts/orchestrator.ts`: `openReviewIssues()`
- `scripts/orchestrator.ts`: `cmdSignoff()`
- `commands/make.md`: reviewer sign-off workflow

### High: Path/glob expansion shells out with unquoted input

`resolveTestPaths()` treats unmatched path tokens as globs by running:

```ts
spawnSync("bash", ["-lc", `ls -1 ${tok} 2>/dev/null`], ...)
```

Impact: `--paths` input is effectively shell-interpreted. This is avoidable command injection
surface in a deterministic gate script.

Recommendation: replace shell-based glob handling with a non-shell resolver, or strictly validate
tokens and pass paths through safe APIs.

Relevant code:
- `scripts/orchestrator.ts`: `resolveTestPaths()`

### Medium: Manual validation skips test integrity

`cmdSignoff()` only verifies locked tests when the run is not manual:

```ts
if (!manualReason) {
  const integ = verifyIntegrity(s);
  ...
}
```

Impact: if tests were locked and the run later uses manual validation, test tampering is not checked.
That weakens the documented "four gates" model.

Recommendation: if a test lock exists, verify it at sign-off regardless of validation mode.

Relevant code:
- `scripts/orchestrator.ts`: `cmdSignoff()`

### Medium: Implementer prompt contradicts test ownership

`agents/implementer.md` correctly says the implementer must never create, edit, weaken, or delete
test files. Later, the `adapt` mode instruction says to "extend tests alongside the change."

Impact: this gives the implementer conflicting instructions and weakens the tester-only test
ownership invariant.

Recommendation: rewrite the adapt-mode instruction so the implementer asks the tester to extend
tests, while the implementer only changes production code.

Relevant code:
- `agents/implementer.md`

### Low: Project guidance is stale about tests

`CLAUDE.md` says there is no test suite for the plugin scripts, but `package.json` defines:

```json
"test": "tsx scripts/selftest.ts"
```

Impact: future maintainers may skip the real deterministic selftest suite.

Recommendation: update `CLAUDE.md` to list both verification gates:

```bash
npm run typecheck
npm test
```

Relevant code:
- `CLAUDE.md`
- `package.json`
- `scripts/selftest.ts`

## How It Works

`tulpkit` is a Claude Code plugin with two main capabilities.

The first is a git-backed task system. It creates task folders under `tasks/list/...`, stores the
task spec in `issue.md`, and mirrors current state through one symlink under `tasks/by-state/...`.
Planning creates a sorted task tree; `/tulpkit:make` runs each leaf.

The second is orchestrated delivery. `/tulpkit:make` drives a task through `scripts/orchestrator.ts`:

1. Initialize run state in the consuming repo.
2. Choose `quick` or `full` staffing.
3. Assemble and freeze the spec with `spec-lock`.
4. Decide validation policy: `tdd`, `adapt`, or `manual`.
5. Have the tester author and lock tests.
6. Have the implementer make validation pass.
7. Run reviewer/implementer iterations until zero open issues.
8. Sign off only when the gates pass.

The Stop hook runs `scripts/enforce-signoff.ts` on every attempted stop. If an orchestration run is
active and unsigned, it returns a blocking JSON decision, forcing the session to continue. A
`MAX_BLOCKS` safety valve prevents an infinite loop.

The intended sign-off gates are:

1. Executable validation: a real green test run, or a recorded manual exception.
2. Test integrity: locked tester-authored tests are unchanged.
3. Spec conformance: explicit attestation against acceptance criteria, with spec-lock integrity
   when available.
4. Auditable checklist: at least four non-empty checks and zero open review issues.

## Verification

Fresh verification run during this review:

```bash
npm run typecheck
```

Result: passed.

```bash
npm test
```

Result: passed, all 74 selftest checks passed.

Codex detection in the selftest reported Codex available locally via `~/.codex/auth.json`.

## Opinion

The architecture is solid. The state-machine approach is the right backbone for an agent workflow
plugin because it makes progress auditable and moves the important gates out of prose-only prompts.
The Stop hook, spec lock, test lock, manual-validation fences, and optional Codex bridge are all
well-aligned with the project goal.

The main weakness is that a few key social contracts are not yet fully mechanical. In particular,
review is described as mandatory but not enforced at sign-off, and test integrity is skipped for
manual validation. Fixing those, plus removing shell-based glob expansion, would make the plugin
substantially more trustworthy as an enforceable delivery system.

## Product Suggestion: Adaptive Rigor

The current workflow is powerful, but it risks feeling too complex as the default user experience.
The better shape is probably:

```text
mode: auto | quick | full
default: auto
```

In `auto`, the orchestrator starts simple, evaluates risk, and escalates only when the work justifies
more process. `quick` and `full` remain available as explicit overrides, but most users should be
able to run:

```bash
/tulpkit:make <task or request>
```

and let the orchestrator choose the right level of rigor.

### Adaptive Route

The orchestrator should perform an early triage step:

1. Read the request or task.
2. Inspect enough repo context to estimate blast radius.
3. Detect validation/test setup.
4. Score risk across concrete dimensions.
5. Select the route and explain it briefly.
6. Ask the user only when escalation creates durable overhead or materially increases cost/time.

Example output:

```text
Route selected: quick
Why:
- localized change
- existing validation command detected
- no durable architecture or product-rule change

Added gates:
- validation
- reviewer sign-off
```

For a riskier task:

```text
Route selected: full
Why:
- touches orchestration state
- changes sign-off behavior
- affects Stop hook enforcement

Added:
- architect
- spec lock
- stricter review
```

### Escalation Criteria

Add `domain-researcher` when:

- external APIs, protocols, standards, or regulations are involved
- behavior depends on vendor documentation or current external facts
- the domain is unfamiliar or ambiguous

Add `system-architect` when:

- the task touches shared interfaces, state machines, auth, billing, permissions, migrations, or
  deployment/runtime behavior
- the change spans multiple modules
- the task introduces or changes a durable abstraction
- the implementation has meaningful rollback or compatibility risk

Suggest a `skill-spec` when:

- the decision will govern future tasks
- the task introduces a reusable concept or product rule
- future agents need to inherit this knowledge
- architecture or design language changes in a durable way

Suggest a task tree / planning pass when:

- the request contains multiple independently deliverable pieces
- acceptance criteria are unclear
- work cannot be validated cleanly in one pass
- there are ordered dependencies

Add N-critic review when:

- security, data loss, payments, auth, migrations, legal/compliance, or user privacy are involved
- validation is weak or manual
- the diff is large or cross-cutting
- the first reviewer finds repeated or severe issues

### Automatic vs. User-Approved Escalation

Some escalations should be automatic:

- choose `full` when blast radius is high
- add an architect for shared contracts or state-machine changes
- require a reviewer before sign-off
- use existing validation when detected
- verify locked specs/tests when locks exist

Some escalations should ask the user first:

- create a durable `skill-spec`
- decompose into a task tree
- require an N-critic panel when it will materially increase time/cost
- convert an apparently small task into a broader planned effort

Example:

```text
This looks durable: it changes how plugin task specs are represented.
I recommend creating a skill-spec so future tasks inherit the rule.
Proceed with a skill-spec, or keep this as a task-local spec?
```

### Recommended Direction

Keep the current strict machinery, but stop exposing it as the default mental model. Make `auto` the
normal path and let the orchestrator lead:

```ts
route = {
  mode: "auto",
  tier: "quick" | "full",
  addResearcher: boolean,
  addArchitect: boolean,
  requireSpecLock: boolean,
  requireTestLock: boolean,
  suggestSkillSpec: boolean,
  suggestTaskTree: boolean,
  minCritics: 1 | 2 | 3
}
```

This would turn `tulpkit` from a heavy process the user has to understand up front into a workflow
that applies judgment. The user gets a simple default, while high-risk work still earns the stronger
barriers.
