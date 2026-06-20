# tulpkit

A Claude Code **marketplace** hosting the `tulpkit` plugin: research-backed, staged
multi-agent delivery (`/tulpkit:make`) enforced to a validation-gated, auditable sign-off,
plus a git-backed folder task system (`/add`, `/list`, `/remove`, `/make`).

The plugin lives in [`plugins/tulpkit/`](plugins/tulpkit/). The repo root is the marketplace
wrapper.

## Install

Add this marketplace, then install the plugin:

```
/plugin marketplace add fedenunez/tulpkit
/plugin install tulpkit@fedenunez
```

## What you get

- **Orchestrated delivery** — `/tulpkit:make` drives a deterministic state machine through
  staged subagent roles to four enforced sign-off gates (executable validation, test
  integrity, spec-conformance attestation, auditable checklist).
- **Tasks** — `/add`, `/list`, `/remove`, `/make`: a folder-based, git-backed task system.

## Why these design choices

Every gate and role/model decision is evidence-backed:

- [`docs/README.html`](docs/README.html) — overview + full orchestration flow
- [`docs/evidence.html`](docs/evidence.html) — the evidence behind each decision
- [`docs/research.html`](docs/research.html) — the full underlying analysis

## Working on the plugin

See [`CLAUDE.md`](CLAUDE.md). From `plugins/tulpkit/`: `npm run typecheck` and `npm test`
are the verification gates.
