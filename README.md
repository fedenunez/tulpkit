# tulpkit — a Claude Code plugin

> **A research-backed Claude Code plugin by [fedenunez](https://github.com/fedenunez).**
> Every design decision traces to a study. See **[`README.html`](README.html)** (visual overview),
> **[`evidence.html`](evidence.html)** (every decision → the paper backing it), and
> **[`research.html`](research.html)** (the full adversarial analysis, reweighted for current frontier models).


Two capabilities in one plugin:

1. **Orchestrated delivery** — type `/tulpkit:make <what you want>` and
   Claude runs the job as a staged, small-team workflow (assemble-brief → research → architecture
   → build → review loop). A **Stop hook refuses to end the session** until validation passes,
   the tester's locked tests are intact, and the reviewer signs off with a spec-conformance
   attestation. Writes stay single-threaded; the reviewer runs on a different model than the
   implementer (or **Codex**, cross-vendor, when it's installed).
2. **Tasks** — a git-backed, folder-based task system (`/add`, `/list`, `/remove`,
   and `/make <slug>` to execute one) with `tasks/list/...` folders and `tasks/by-state/...` symlinks.

Built entirely from real Claude Code plugin primitives: a manifest, commands, agents, skills,
a `Stop` hook, and three small TypeScript scripts.

## Install

It's a normal plugin directory (`.claude-plugin/plugin.json` + components at root).

```bash
# load locally for a session
claude --plugin-dir /path/to/tulpkit
# or install via the bundled marketplace (the repo is its own one-entry catalog):
/plugin marketplace add /path/to/tulpkit      # or:  owner/repo  for GitHub
/plugin validate .                                     # sanity-check plugin.json + marketplace.json
/plugin install tulpkit@fedenunez                 # <plugin>@<marketplace>
```

### Naming

| Thing | Name | Where it's set | How you use it |
| --- | --- | --- | --- |
| **Marketplace** (the catalog) | `fedenunez` | `.claude-plugin/marketplace.json` → `name` | the part after `@` when installing; rename to your org/team |
| **Plugin** (the tool) | `tulpkit` | `.claude-plugin/plugin.json` → `name`, and the marketplace entry | what you install, and the command **namespace** |
| **Source** (where files live) | `./` | marketplace entry → `source` | a local `./path` or `owner/repo` |

So you install `tulpkit` *from* the `fedenunez` catalog → `tulpkit@fedenunez`, and its
commands are namespaced under the plugin name: `/tulpkit:make` (or plain
`/make` when there's no collision). Add more plugins to `fedenunez` later by appending entries
to the `plugins` array.

The scripts run with `npx tsx`, so the only requirement is Node (tsx is fetched on first run,
or `npm i -D tsx` for speed). Restart / `/reload-plugins` after changing agents or hooks.

## Commands (namespaced under the plugin)

| Command | Does |
| --- | --- |
| `/tulpkit:make [quick\|full] <text \| task-slug>` | Run the staged, gated orchestration. `quick` (small/coupled change) runs the 3 gate-critical roles only; `full` (default) adds research + architecture — **same gates either way**. Free text → ad-hoc; an existing task slug → run it and move `inprogress`→`done`. |
| `/tulpkit:add [proposal\|task\|bug\|feature] <title>` | Create a task; first word = category (default `task`). |
| `/tulpkit:list [proposal\|pending\|in-progress\|done]` | List a state (default `pending`) in detail + counters for every state. |
| `/tulpkit:remove <task-slug>` | Delete a task's folder + state symlink (git-recoverable). |

(Plain `/make`, `/add`, … work too when names don't collide.)

## How orchestration works

The **main-session orchestrator owns the state machine** (`scripts/orchestrator.ts`):
`init → detect → validation → phase → tests-lock → test → review → signoff`. Subagents (in `agents/`) do
the work and **report**; the orchestrator records. This keeps writes single-threaded and
avoids relying on `${CLAUDE_PLUGIN_ROOT}` inside subagent shells.

Four hard exit gates, all deterministic:

- **Validation, adapted to the project.** `detect` inspects the repo; the policy is `tdd`
  (test-first; greenfield default), `adapt` (existing test setup), or `manual` (recorded
  exception). For tdd/adapt the CLI *runs the real test command and checks exit 0*. `manual` is
  fenced: refused when a test runner is detectable (audited override required), declared up front
  (no sign-off-time bypass), and unavailable once a green run exists — so it can't be used to quit
  under the Stop hook's pressure.
- **Test integrity.** The tester locks its tests (`tests-lock`); if the implementer weakened or
  deleted them, sign-off is refused — green only counts on intact tests (capable models game
  gates they can edit).
- **Spec-conformance attestation.** Sign-off requires a `spec_conformance` check — that the
  acceptance criteria are met, not merely that tests pass.
- **Auditable sign-off.** Checklist with ≥ 4 non-empty items and zero open review issues.

**Cross-vendor review (optional).** If `scripts/codex.ts detect` finds Codex installed and
logged in, the orchestrator routes the review (and optionally first-cut tests) through it — the
most independent check, since self-preference bias is strongest within a model family. No Codex?
It falls back to the `code-reviewer` subagent on a different Claude model than the implementer.

The `Stop` hook (`scripts/enforce-signoff.ts`, wired in `hooks/hooks.json`) blocks the session
from ending until both gates clear, with an 8-block safety valve.

### ⚠ Stop-hook reliability note

Plugin-delivered `Stop` hooks have historically had a bug where the block halts instead of
continuing. If your Claude Code version doesn't continue on the block, copy the hook into your
project's `.claude/settings.json` (this path is reliable):

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command",
        "command": "npx tsx /abs/path/to/tulpkit/scripts/enforce-signoff.ts" } ] }
    ]
  }
}
```

## Tasks system (schema)

Run at any `tasks/` root — repo root for cross-cutting work, a subproject for scoped work.

```
tasks/list/{type}-{id}-{slug}/   issue.md [attachments] [specs.html]
tasks/by-state/{state}/{folder}  ->  ../../list/{folder}   (relative symlink)
```

`type` = issue|task|feature (bug = issue + `kind: bug`) · `state` = proposed · pending ·
inprogress · done · rft · rejected. One symlink per task = its state; `issue.md` frontmatter
mirrors it. Drive it via the commands above or directly:

```bash
npx tsx scripts/tasks.ts new  --type task --title "Add listening page" [--root packages/web]
npx tsx scripts/tasks.ts move --task 0007 --to inprogress
npx tsx scripts/tasks.ts list [--state inprogress]
```

Full schema: the `tasks` skill. Commit the `list/` folder and the `by-state/` symlink together.

## Memory (project-level)

Plugins don't auto-load `CLAUDE.md`, so copy `examples/CLAUDE.md` and `examples/LEARNINGS.md`
into your repo root. They wire the read-before / append-after learnings loop and point Claude
at the plugin's commands and skills.

## Layout

```
.claude-plugin/plugin.json   manifest
commands/                    make, add, list, remove
agents/                      5 core roles + ux-designer (on-demand): researcher, architect,
                             implementer (writes), tester (owns tests), reviewer (≠ author)
skills/                      orchestrated-delivery · specialist-protocol · tasks
hooks/hooks.json             the Stop-hook wiring
scripts/                     orchestrator.ts · enforce-signoff.ts · tasks.ts · codex.ts (TypeScript)
examples/                    CLAUDE.md · LEARNINGS.md (copy to your repo)
README.html                  visual, animated overview
evidence.html                every decision → the evidence backing it
research.html                the full adversarial analysis
```

## Honest limitations

- **What's mechanically enforced vs. attested.** Three things are enforced by *code* and can't be
  talked past: a real exit-0 test run, the hash-based test-integrity lock, and the `manual` fence.
  The rest — the `spec_conformance` attestation and the ≥4-item checklist — are *auditable* (they
  leave a reviewable trail), not machine-verified: they're free-text the reviewer asserts, and a
  reviewer that lies satisfies them. They raise the cost of skipping a step and give a human
  something to audit; they don't prove conformance. The orchestrator that records the gates is also
  the model doing the work, so the hard floor is the three mechanical checks, not the paperwork.
- The gate proves the test command exits 0, not that the tests are *strong*; under `adapt` a
  thin suite is a weak signal. The tester writing real failure/edge cases and the reviewer's
  coverage check backstop that.
- The reviewer is an LLM judge (self-preference/position bias), so it runs on a different model
  than the implementer by default, and on **Codex (a different vendor) when available** — the
  strongest mitigation. For high-stakes work, require human sign-off too.
- Test integrity is hash-based: it catches edits to *locked* tests, so the tester must lock the
  real suite. It can't judge whether unlocked or pre-existing tests are *strong* — the reviewer's
  spec-conformance check backstops that.
- `${CLAUDE_PLUGIN_ROOT}` reliably expands in **hooks** (used by the Stop hook), but its
  expansion inside **slash-command bodies** has been reported as flaky in some Claude Code
  versions. The `/add-*` commands rely on it; if a command can't find the script, the env
  var was unset in that shell — invoke the script by its install path, or let the
  orchestrator (which owns the state machine) run it. This is also why subagents never call
  the scripts directly.
- Symlinks assume a POSIX filesystem; on Windows, enable developer mode or run under WSL.
- Multi-agent fan-out helps parallel, read-heavy work; it's overkill for small/coupled tasks.
  Default to fewer agents and only fan out when the work is genuinely parallel — that's what the
  `quick` tier of `/make` is for (the 3 gate-critical roles, same gates, no research/architecture
  ceremony).
