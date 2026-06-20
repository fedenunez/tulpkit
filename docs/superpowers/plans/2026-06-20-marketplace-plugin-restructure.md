# Marketplace/Plugin Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshuffle the repo into a pure marketplace wrapper at root with the entire plugin nested, self-contained, under `plugins/tulpkit/`; declutter the root; consolidate docs — with no change to any capability behavior.

**Architecture:** Pure mechanical move. `git mv` the plugin primitives + dev tooling into `plugins/tulpkit/`; move the HTML rationale and dev artifacts into `docs/`; repoint the handful of references that cross the new boundary (`marketplace.json` source, `plugin.json` homepage, three `selftest.ts` reads of root-level files); add a `README.md`. The Stop hook and all commands use `${CLAUDE_PLUGIN_ROOT}`, which auto-resolves, so they need no edits. `selftest.ts` derives `REPO` from its own location, so its plugin-internal assertions auto-follow the move.

**Tech Stack:** git, Node built-in TypeScript scripts run via `npx tsx`, no build/runtime.

**Spec:** `docs/superpowers/specs/2026-06-20-marketplace-plugin-restructure-design.md`

---

## File Structure (what moves where)

**Into `plugins/tulpkit/` (self-contained plugin):**
- `agents/ commands/ skills/ hooks/ scripts/ examples/` (tracked → `git mv`)
- `.claude-plugin/plugin.json` (tracked → `git mv`; **`marketplace.json` stays at root**)
- `package.json package-lock.json tsconfig.json` (tracked → `git mv`)
- `node_modules/` (untracked → plain `mv`)

**Into `docs/` (rationale + parked artifacts):**
- `README.html evidence.html research.html` → `docs/` (`git mv`)
- `REVIEW.md stop-prompting-analysis.md` → `docs/dev/` (`git mv`)

**Stays at repo root:**
- `.claude-plugin/marketplace.json`, `CLAUDE.md`, `.gitignore`, `docs/`, new `README.md`

**Edited (cross-boundary references only):**
- `.claude-plugin/marketplace.json` — `source`, description
- `plugins/tulpkit/.claude-plugin/plugin.json` — `homepage`, description
- `plugins/tulpkit/scripts/selftest.ts` — add `ROOT` anchor for the 3 root-file reads; add a source assertion
- `CLAUDE.md` — structure framing + paths
- `README.md` — new

> **Atomicity note:** Intermediate states are broken (selftest fails until paths are fixed). Do the moves AND edits, verify green, then make **one commit**. Do not commit between Task 1 and Task 7.

> **Pre-commit hook note:** This repo's pre-commit hook tries to read `/dev/tty` and prints `No such device or address` then a `(y/n)` prompt; the commit still completes in this non-interactive environment. That output is expected — not a failure.

---

### Task 1: Nest the plugin under `plugins/tulpkit/`

**Files:**
- Create dir: `plugins/tulpkit/` and `plugins/tulpkit/.claude-plugin/`
- Move (git): `agents/ commands/ skills/ hooks/ scripts/ examples/ .claude-plugin/plugin.json package.json package-lock.json tsconfig.json`
- Move (plain): `node_modules/`

- [ ] **Step 1: Create the plugin skeleton dirs**

```bash
cd /home/fede/repos/tulpkit/tulpkit
mkdir -p plugins/tulpkit/.claude-plugin
```

- [ ] **Step 2: git mv the tracked plugin primitives and dev tooling**

```bash
git mv agents commands skills hooks scripts examples plugins/tulpkit/
git mv .claude-plugin/plugin.json plugins/tulpkit/.claude-plugin/plugin.json
git mv package.json package-lock.json tsconfig.json plugins/tulpkit/
```

- [ ] **Step 3: Move untracked node_modules with plain mv (git won't move ignored files)**

```bash
mv node_modules plugins/tulpkit/node_modules
```

- [ ] **Step 4: Verify the root is decluttered and the plugin is whole**

```bash
ls -A1 .                       # expect: .claude-plugin .git .gitignore CLAUDE.md docs plugins
ls -A1 .claude-plugin          # expect: marketplace.json   (plugin.json now under plugins/)
ls -A1 plugins/tulpkit         # expect: .claude-plugin agents commands examples hooks node_modules package-lock.json package.json scripts skills tsconfig.json
```

Expected: root shows only the wrapper + `plugins/`; `marketplace.json` is the lone file in root `.claude-plugin/`.

---

### Task 2: Move the HTML rationale and park dev artifacts under `docs/`

**Files:**
- Move (git): `README.html evidence.html research.html` → `docs/`
- Create dir + move (git): `REVIEW.md stop-prompting-analysis.md` → `docs/dev/`

- [ ] **Step 1: Move the rich HTML rationale into docs/**

```bash
cd /home/fede/repos/tulpkit/tulpkit
git mv README.html evidence.html research.html docs/
```

- [ ] **Step 2: Park the working artifacts under docs/dev/**

```bash
mkdir -p docs/dev
git mv REVIEW.md stop-prompting-analysis.md docs/dev/
```

- [ ] **Step 3: Verify**

```bash
ls -A1 docs        # expect: README.html dev evidence.html research.html superpowers
ls -A1 docs/dev    # expect: REVIEW.md stop-prompting-analysis.md
```

Expected: no `*.html` or stray `*.md` left at repo root except `CLAUDE.md` (and the new `README.md` after Task 6).

---

### Task 3: Repoint the marketplace manifest at the nested plugin

**Files:**
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Update `source` and drop the html-file paths from the description**

Change the `plugins[0]` entry. Current:

```json
    {
      "name": "tulpkit",
      "source": "./",
      "description": "Research-backed staged orchestration (/tulpkit:make) + git-backed tasks. Decision evidence in evidence.html; full analysis in research.html.",
      "version": "1.1.0"
    }
```

To:

```json
    {
      "name": "tulpkit",
      "source": "./plugins/tulpkit",
      "description": "Research-backed staged orchestration (/tulpkit:make) + git-backed tasks. Decision evidence and full analysis in docs/.",
      "version": "1.1.0"
    }
```

- [ ] **Step 2: Validate the JSON parses**

Run: `cd /home/fede/repos/tulpkit/tulpkit && node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8')); console.log('ok')"`
Expected: `ok`

---

### Task 4: Repoint the plugin manifest homepage and description

**Files:**
- Modify: `plugins/tulpkit/.claude-plugin/plugin.json`

- [ ] **Step 1: Update `homepage` to the GitHub repo URL and reword the description**

Current `description` (line 4) and `homepage` (line 16):

```json
  "description": "Research-backed staged multi-agent delivery (validation-gated, test-integrity, cross-vendor review) + a git-backed folder task system. Every decision is evidence-backed — see evidence.html.",
```
```json
  "homepage": "README.html"
```

Change to:

```json
  "description": "Research-backed staged multi-agent delivery (validation-gated, test-integrity, cross-vendor review) + a git-backed folder task system. Every decision is evidence-backed — see docs/evidence.html.",
```
```json
  "homepage": "https://github.com/fedenunez/tulpkit"
```

> If a git remote gets set and differs from `fedenunez/tulpkit`, update this URL to match.

- [ ] **Step 2: Validate the JSON parses**

Run: `cd /home/fede/repos/tulpkit/tulpkit && node -e "JSON.parse(require('fs').readFileSync('plugins/tulpkit/.claude-plugin/plugin.json','utf8')); console.log('ok')"`
Expected: `ok`

---

### Task 5: Fix the three `selftest.ts` reads that cross the new boundary

`REPO` (`scripts/../` = the plugin root) now resolves correctly for every plugin-internal read. Three reads target files that **stay at repo root** (`marketplace.json`, `CLAUDE.md`) and need a `ROOT` anchor (`REPO/../..`). Also add an assertion locking the new `source`.

**Files:**
- Modify: `plugins/tulpkit/scripts/selftest.ts`

- [ ] **Step 1: Add a `ROOT` constant next to `REPO`**

Find (around line 18):

```ts
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
```

Add immediately after it:

```ts
// The plugin lives at plugins/tulpkit/; the marketplace wrapper + CLAUDE.md live two levels up.
const ROOT = path.resolve(REPO, "..", "..");
```

- [ ] **Step 2: Read `marketplace.json` from ROOT and assert the nested source**

In `testStructure()`, find:

```ts
  const market = readJson(".claude-plugin/marketplace.json");
  const entry = (market.plugins || []).find((p: any) => p.name === "tulpkit");
  check("marketplace lists the tulpkit plugin", !!entry);
```

Replace with:

```ts
  const market = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "marketplace.json"), "utf8"));
  const entry = (market.plugins || []).find((p: any) => p.name === "tulpkit");
  check("marketplace lists the tulpkit plugin", !!entry);
  check("marketplace source points at the nested plugin", entry?.source === "./plugins/tulpkit");
```

- [ ] **Step 3: Read `CLAUDE.md` from ROOT in the two finding-5 checks**

Find (around line 480):

```ts
  check("CLAUDE.md documents `npm test` as a verification gate (finding 5)",
    contains("CLAUDE.md", /npm test/) && !contains("CLAUDE.md", /no test suite for the plugin/i));
```

Replace with:

```ts
  const containsRoot = (rel: string, re: RegExp) => re.test(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  check("CLAUDE.md documents `npm test` as a verification gate (finding 5)",
    containsRoot("CLAUDE.md", /npm test/) && !containsRoot("CLAUDE.md", /no test suite for the plugin/i));
```

> Note: the `contains(...)` helper (REPO-relative) stays for all the skill/agent reads inside the plugin. Only the two `CLAUDE.md` reads switch to `containsRoot`.

- [ ] **Step 4: (Deferred to Task 8) do not run selftest yet — CLAUDE.md edits land in Task 6**

---

### Task 6: Update root `CLAUDE.md` for the new structure

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the "What this repo is" framing**

Find the sentence describing the deliverable location:

```
the deliverable is the set of plugin primitives at the repo root: a manifest, slash commands, subagent
definitions, skills, a `Stop` hook, and four TypeScript scripts run via `npx tsx`.
```

Replace "at the repo root" with the nested location:

```
the deliverable is the set of plugin primitives under `plugins/tulpkit/`: a manifest, slash commands,
subagent definitions, skills, a `Stop` hook, and four TypeScript scripts run via `npx tsx`. The repo
root is a thin **marketplace wrapper** (`.claude-plugin/marketplace.json` + `README.md` + `docs/`).
```

- [ ] **Step 2: Repoint the example-template and HTML-file paths**

- Change `examples/CLAUDE.md` / `examples/LEARNINGS.md` references to `plugins/tulpkit/examples/CLAUDE.md` / `plugins/tulpkit/examples/LEARNINGS.md`.
- Change the "HTML files (`README.html`, `evidence.html`, `research.html`)" reference to `docs/README.html`, `docs/evidence.html`, `docs/research.html`.
- In the Commands block, note that `npm run typecheck` / `npm test` / `npx tsx scripts/...` run **from `plugins/tulpkit/`** (where `package.json` now lives).

- [ ] **Step 3: Verify the finding-5 phrases the selftest greps for are still present**

```bash
cd /home/fede/repos/tulpkit/tulpkit
grep -q 'npm test' CLAUDE.md && echo "npm test: present"
grep -iqv 'no test suite for the plugin' CLAUDE.md && echo "negative phrase: absent"
```

Expected: `npm test: present` and the negative phrase absent (the second grep should NOT match it).

---

### Task 7: Write the root `README.md` landing page

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write a concise GitHub landing page that links into docs/**

```markdown
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
```

- [ ] **Step 2: Verify it renders as valid markdown (no broken local links)**

```bash
cd /home/fede/repos/tulpkit/tulpkit
for p in plugins/tulpkit docs/README.html docs/evidence.html docs/research.html CLAUDE.md; do
  test -e "$p" && echo "ok: $p" || echo "BROKEN LINK: $p"
done
```

Expected: every line prints `ok:`.

---

### Task 8: Verify green from the plugin dir, then commit atomically

**Files:** none (verification + commit)

- [ ] **Step 1: Typecheck from the plugin dir**

Run: `cd /home/fede/repos/tulpkit/tulpkit/plugins/tulpkit && npm run typecheck`
Expected: exits 0, no output (tsc --noEmit clean).

- [ ] **Step 2: Run the selftest from the plugin dir**

Run: `cd /home/fede/repos/tulpkit/tulpkit/plugins/tulpkit && npm test`
Expected: all checks pass, including the new `marketplace source points at the nested plugin` and the two finding-5 CLAUDE.md checks; exit 0.

- [ ] **Step 3: Sanity-check the Stop-hook path resolves under the nest**

Run: `cd /home/fede/repos/tulpkit/tulpkit && test -f plugins/tulpkit/scripts/enforce-signoff.ts && grep -q 'CLAUDE_PLUGIN_ROOT}/scripts/enforce-signoff.ts' plugins/tulpkit/hooks/hooks.json && echo "hook path ok"`
Expected: `hook path ok` (the hook references `${CLAUDE_PLUGIN_ROOT}/scripts/...`, which resolves to `plugins/tulpkit/` at install time).

- [ ] **Step 4: Review the staged rename set**

Run: `cd /home/fede/repos/tulpkit/tulpkit && git add -A && git status --short`
Expected: renames (`R`) for every moved file (history preserved), `M` for the edited manifests/selftest/CLAUDE.md, and a new (`A`) `README.md`. No unexpected deletions.

- [ ] **Step 5: Commit (single atomic commit)**

```bash
cd /home/fede/repos/tulpkit/tulpkit
git commit -m "$(cat <<'EOF'
refactor: nest plugin under plugins/tulpkit, declutter root, consolidate docs

Repo root is now a pure marketplace wrapper (marketplace.json + README.md +
docs/). The entire self-contained plugin moves to plugins/tulpkit/. HTML
rationale moves to docs/; dev artifacts park in docs/dev/. Repoint
marketplace source, plugin homepage, and the three selftest reads that cross
the new boundary. No capability behavior changed; selftest green.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds (the `/dev/tty` pre-commit prompt output is expected and non-fatal).

---

## Self-Review

**Spec coverage:**
- Nest plugin under `plugins/tulpkit/` → Task 1. ✓
- `README.md` at root + HTML in `docs/` → Tasks 2, 7. ✓
- Dev tooling inside the plugin → Task 1 (package.json/tsconfig/node_modules). ✓
- `homepage` → GitHub repo URL → Task 4. ✓
- `marketplace.json` source update → Task 3. ✓
- Dev artifacts to `docs/dev/`, kept not deleted → Task 2. ✓
- Reference updates (CLAUDE.md, selftest) → Tasks 5, 6. ✓
- Verification checklist (CLAUDE_PLUGIN_ROOT resolves, typecheck, selftest, marketplace resolves, no behavior change) → Task 8. ✓
- `hooks.json` no change / scripts write to consuming cwd → confirmed in plan notes, Task 8 Step 3. ✓

**Placeholder scan:** No TBD/TODO; every edit shows exact before/after content and exact commands with expected output.

**Type/path consistency:** `REPO` unchanged; new `ROOT = resolve(REPO, "..", "..")` used consistently for the marketplace and CLAUDE.md reads; `contains` (REPO-relative) retained for in-plugin reads, `containsRoot` introduced only for the two CLAUDE.md checks; `source` string `"./plugins/tulpkit"` matches between Task 3 (manifest) and Task 5 (assertion).
