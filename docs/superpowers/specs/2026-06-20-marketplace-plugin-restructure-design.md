# Design: Marketplace/Plugin Restructure & Cleanup

**Date:** 2026-06-20
**Status:** Approved (design), pending implementation plan
**Topic:** Reshuffle the repo into a clean, reusable marketplace wrapper with a self-contained nested plugin; declutter the root; consolidate docs.

## Problem

The repo is simultaneously a Claude Code *marketplace* and a single *plugin*, sharing one
root (`marketplace.json` uses `source: "./"`). Consequences:

- **Root clutter:** dev artifacts (`REVIEW.md`, `stop-prompting-analysis.md`, `research.html`,
  `evidence.html`) sit beside shippable plugin primitives.
- **Marketplace/plugin boundary is implicit:** the marketplace can only ever host this one
  plugin, and "what ships with the plugin" vs "what is project rationale" is unclear.
- **No GitHub landing page:** there is only `README.html`, so the repo root renders nothing
  useful on GitHub.

Out of scope (explicitly): changing any capability *internals* — the orchestrator state machine,
the four sign-off gates, the tasks system, the planning skill, agent/model policy. This is a
**structural reshuffle and cleanup only**. Behavior must be identical before and after.

## Decisions (locked)

1. **Nest the plugin** under `plugins/tulpkit/`; the repo root becomes a pure marketplace
   wrapper that can host additional plugins later.
2. **`README.md` at root** as the GitHub landing page; the rich HTML rationale
   (`README.html`, `evidence.html`, `research.html`) moves into `docs/`.
3. **Dev tooling inside the plugin** (`package.json`, `tsconfig.json`, `node_modules/`) — the
   standard self-contained-plugin convention; each plugin brings its own dev config.
4. **`plugin.json` `homepage`** → the GitHub repo URL (`https://github.com/fedenunez/tulpkit`).
   *Confirm once a git remote is set (none exists today).*

## Target structure

```
repo-root/                              # pure marketplace wrapper
  .claude-plugin/marketplace.json       # source: "./plugins/tulpkit"
  README.md                             # NEW — GitHub landing page
  docs/
    README.html  evidence.html  research.html   # moved from root (rich rationale)
    dev/
      REVIEW.md  stop-prompting-analysis.md      # working artifacts, parked (kept, not deleted)
    superpowers/specs/...                         # design specs stay (skill convention)
  .gitignore

  plugins/tulpkit/                      # self-contained, independently installable plugin
    .claude-plugin/plugin.json
    agents/  commands/  skills/  hooks/
    scripts/  examples/
    package.json  tsconfig.json  node_modules/   # node_modules gitignored
```

Root reduces to: `.claude-plugin/marketplace.json`, `README.md`, `docs/`, `.gitignore`,
`plugins/`.

## Reference updates (the only edits to existing files)

| File | Change |
|---|---|
| `.claude-plugin/marketplace.json` | `source: "./"` → `"./plugins/tulpkit"`; drop `evidence.html`/`research.html` paths from the plugin description (point to repo/docs instead). |
| `plugins/tulpkit/.claude-plugin/plugin.json` | `homepage: "README.html"` → GitHub repo URL; reword the `evidence.html` mention to a `docs/` reference. |
| `plugins/tulpkit/package.json` | No path change to `scripts/*` (already relative); `npm test`/`typecheck` now run from `plugins/tulpkit/`. |
| `.gitignore` | `node_modules` path → `plugins/tulpkit/node_modules` (or keep a root-glob that still matches). |
| Root `CLAUDE.md` | Update the "deliverable is at repo root" framing; repoint HTML-file paths to `docs/`; note plugin now lives under `plugins/tulpkit/`. |
| `commands/*.md` | Verify the "locate the script" fallbacks still resolve under the nested root (`${CLAUDE_PLUGIN_ROOT}` path is unaffected). |

**No change needed:** `hooks/hooks.json` — it uses `${CLAUDE_PLUGIN_ROOT}/scripts/...`, which
resolves to the plugin root wherever it lives. `scripts/*.ts` — they write to the *consuming*
repo's cwd, not their own location.

## Things that must keep working (verification checklist)

These are the invariants the reshuffle must not break — each becomes a verification step in the
plan:

1. `${CLAUDE_PLUGIN_ROOT}` resolves to `plugins/tulpkit/` for the Stop hook and commands
   (driven by where `plugin.json` lives + the marketplace `source` path).
2. `npm run typecheck` passes from `plugins/tulpkit/`.
3. `npm test` (`selftest.ts`) passes from `plugins/tulpkit/` — it asserts plugin structure with
   cwd-relative paths, so it must run from the plugin dir. Add/adjust a selftest assertion for
   the new nesting if one hard-codes a root path.
4. `marketplace.json` validates and its `source` resolves to an installable plugin.
5. The four sign-off gates and tasks behavior are untouched (no script logic edits).

## Dev artifacts & docs handling

- `REVIEW.md`, `stop-prompting-analysis.md` → `docs/dev/`. **Kept**, not deleted (findings from
  `REVIEW.md` were largely addressed by the recent "harden gates" commit, but the record stays).
- New `README.md`: concise overview + install instructions + links to `docs/README.html`,
  `docs/evidence.html`, `docs/research.html`.
- `docs/superpowers/specs/` is unchanged (the brainstorming/planning skills write specs there).

## Risks & mitigations

- **Path breakage after the move** → covered by the verification checklist above; run
  `typecheck` + `selftest` from the new plugin dir before committing.
- **`homepage` URL may be wrong** (no remote yet) → flagged; confirm when the remote is set.
- **`git mv` history** → use `git mv` for all moves so history is preserved.

## Success criteria

- Repo root contains only marketplace wrapper + `README.md` + `docs/` + `plugins/` + dotfiles.
- `plugins/tulpkit/` is self-contained; `npm test` and `npm run typecheck` pass from there.
- `marketplace.json` `source` points to the nested plugin and resolves.
- No capability behavior changed; selftest green.
