#!/usr/bin/env -S npx tsx
/**
 * tasks.ts — git-backed, folder-based task system.
 *
 *   tasks/list/{type}-{id}-{slug}/        issue.md + attachments + specs.html (when needed)
 *   tasks/by-state/{state}/{folder}  ->   relative symlink ../../list/{folder}
 *
 * Run at any `tasks/` root: repo root (cross-cutting) or a subproject (scoped, via --root).
 *
 *   tasks.ts new    --as task --title "Add page" [--id 7] [--root .]
 *                   [--parent <folder|id> --order <n>] [--spec task|skill:<name>] [--tier quick|full]
 *   tasks.ts move   --task <folder|id> --to inprogress
 *   tasks.ts remove --task <folder|id> [--cascade]   # --cascade also removes child tasks
 *   tasks.ts show   --task <folder|id>          # prints folder + issue.md path; exit 1 if missing
 *   tasks.ts list   [--state pending]           # default: pending detail + counters for all states
 *   tasks.ts tree   [--task <root>]             # nested view sorted by order/id (a plan = a subtree)
 *   tasks.ts states
 *
 * Nesting is a logical tree via `parent`/`order` frontmatter — folders stay flat in list/, so the
 * id/symlink invariants are untouched. parent is set only at creation, so cycles can't form.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const STATES = ["proposed", "pending", "inprogress", "done", "rft", "rejected"] as const;
const TYPES = ["issue", "task", "feature"] as const;
type State = (typeof STATES)[number];
type Type = (typeof TYPES)[number];

// /tulpkit:add category → (type, state, kind)
const CATEGORY: Record<string, { type: Type; state: State; kind?: string }> = {
  task: { type: "task", state: "pending" },
  pending: { type: "task", state: "pending" },
  bug: { type: "issue", state: "pending", kind: "bug" },
  feature: { type: "feature", state: "pending" },
  proposal: { type: "feature", state: "proposed" },
};

function args(argv: string[]): Record<string, string> {
  const f: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2);
    f[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
  }
  return f;
}
function slug(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "untitled";
}
function pad(n: number): string { return String(n).padStart(4, "0"); }
function tasksRoot(f: Record<string, string>): string { return path.join(path.resolve(f.root ?? "."), "tasks"); }
function listDir(root: string): string { return path.join(root, "list"); }
function stateDir(root: string, s: State): string { return path.join(root, "by-state", s); }

function normState(s: string | undefined): State | undefined {
  if (!s || s === "true") return undefined;
  const v = s.toLowerCase().replace(/-/g, "");
  const map: Record<string, State> = { proposal: "proposed", inprogress: "inprogress" };
  const r = (map[v] ?? v) as State;
  return STATES.includes(r) ? r : undefined;
}
function nextId(root: string): number {
  const ld = listDir(root);
  if (!fs.existsSync(ld)) return 1;
  let max = 0;
  for (const name of fs.readdirSync(ld)) {
    const m = name.match(/^[a-z]+-(\d+)-/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}
function findFolder(root: string, task: string): string {
  const ld = listDir(root);
  if (fs.existsSync(path.join(ld, task))) return task;
  for (const name of fs.existsSync(ld) ? fs.readdirSync(ld) : [])
    if (name.match(new RegExp(`^[a-z]+-0*${task.replace(/^0+/, "")}-`)) || name.includes(task)) return name;
  throw new Error(`task not found: ${task}`);
}
function currentState(root: string, folder: string): State | null {
  for (const s of STATES) {
    try { if (fs.lstatSync(path.join(stateDir(root, s), folder)).isSymbolicLink()) return s; } catch { /* */ }
  }
  return null;
}
function linkState(root: string, folder: string, s: State): void {
  fs.mkdirSync(stateDir(root, s), { recursive: true });
  const link = path.join(stateDir(root, s), folder);
  if (!fs.existsSync(link)) fs.symlinkSync(path.join("..", "..", "list", folder), link);
}
function setFrontmatterState(issuePath: string, s: State): void {
  if (!fs.existsSync(issuePath)) return;
  fs.writeFileSync(issuePath, fs.readFileSync(issuePath, "utf8").replace(/^(state:\s*).*$/m, `$1${s}`));
}
function counts(root: string): Record<State, number> {
  const c = {} as Record<State, number>;
  for (const s of STATES) {
    const d = stateDir(root, s);
    c[s] = fs.existsSync(d) ? fs.readdirSync(d).length : 0;
  }
  return c;
}

// ---- nesting (logical tree via frontmatter; folders stay flat) ------------
function readFm(root: string, folder: string): Record<string, string> {
  const fm: Record<string, string> = {};
  try {
    const txt = fs.readFileSync(path.join(listDir(root), folder, "issue.md"), "utf8");
    const m = txt.match(/^---\n([\s\S]*?)\n---/);
    if (m) for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* */ }
  return fm;
}
function idOf(folder: string): number { const m = folder.match(/^[a-z]+-(\d+)-/); return m ? parseInt(m[1], 10) : 0; }
/** map of parent-folder ("" = root) → child folders */
function childrenOf(root: string): Map<string, string[]> {
  const ld = listDir(root);
  const map = new Map<string, string[]>();
  for (const name of fs.existsSync(ld) ? fs.readdirSync(ld) : []) {
    if (!fs.statSync(path.join(ld, name)).isDirectory()) continue;
    const parent = readFm(root, name).parent || "";
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent)!.push(name);
  }
  return map;
}
function sortSiblings(root: string, folders: string[]): string[] {
  return [...folders].sort((a, b) => {
    const oa = parseInt(readFm(root, a).order || String(idOf(a)), 10);
    const ob = parseInt(readFm(root, b).order || String(idOf(b)), 10);
    return oa - ob || idOf(a) - idOf(b);
  });
}

// ---- commands -------------------------------------------------------------

function cmdNew(f: Record<string, string>): void {
  const cat = f.as && f.as !== "true" ? CATEGORY[f.as.toLowerCase()] : undefined;
  if (f.as && f.as !== "true" && !cat) throw new Error(`--as must be one of ${Object.keys(CATEGORY).join("|")}`);
  const type = (f.type as Type) ?? cat?.type ?? "task";
  if (!TYPES.includes(type)) throw new Error(`--type must be one of ${TYPES.join("|")}`);
  const state = (normState(f.state) ?? cat?.state ?? "proposed") as State;
  const kind = f.kind && f.kind !== "true" ? f.kind : cat?.kind;
  const title = f.title && f.title !== "true" ? f.title : "untitled";
  const root = tasksRoot(f);
  const id = f.id && f.id !== "true" ? parseInt(f.id, 10) : nextId(root);
  const folder = `${type}-${pad(id)}-${slug(title)}`;

  // optional nesting: --parent <folder|id> (logical tree; folders stay flat) + --order <n>.
  // parent is set only at creation, so cycles are structurally impossible.
  const parent = f.parent && f.parent !== "true" ? findFolder(root, f.parent) : ""; // throws if missing
  const order = f.order && f.order !== "true" ? parseInt(f.order, 10) : id;
  // spec home (task | skill:<name>) + optional tier hint consumed by /plan and /make.
  const spec = f.spec && f.spec !== "true" ? f.spec : "task";
  const tier = f.tier && f.tier !== "true" ? f.tier : "";

  const dir = path.join(listDir(root), folder);
  if (fs.existsSync(dir)) throw new Error(`already exists: ${folder}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "issue.md"), [
    "---", `type: ${type}`, `id: "${pad(id)}"`,
    ...(kind ? [`kind: ${kind}`] : []),
    `state: ${state}`, `title: ${title}`, `created: ${new Date().toISOString()}`,
    `scope: ${f.scope ?? "root"}`,
    `spec: ${spec}`,
    ...(parent ? [`parent: ${parent}`, `order: ${order}`] : []),
    ...(tier ? [`tier: ${tier}`] : []),
    "---", "", `# ${title}`, "",
    "## Context", "",
    "## Acceptance criteria", "- [ ] ", "",
    "## Constraints", "_Hard requirements, perf/security budgets, must-use libs._", "",
    "## Out of scope", "_What this task explicitly does NOT cover._", "",
    "## Prior art / references", "_Existing code, docs, or patterns to follow._", "",
    "## Notes", "",
  ].join("\n"));
  linkState(root, folder, state);
  console.log(`+ ${folder}  [${state}]${parent ? `  ↳ parent ${parent} (order ${order})` : ""}`);
  console.log(`  ${path.relative(process.cwd(), path.join(dir, "issue.md"))}`);
}

function cmdMove(f: Record<string, string>): void {
  const root = tasksRoot(f);
  const to = normState(f.to);
  if (!to) throw new Error(`--to must be one of ${STATES.join("|")}`);
  if (!f.task || f.task === "true") throw new Error("--task <folder|id> required");
  const folder = findFolder(root, f.task);
  const from = currentState(root, folder);
  if (from) fs.unlinkSync(path.join(stateDir(root, from), folder)); // unlink the symlink itself; rmSync follows it to the dir
  linkState(root, folder, to);
  setFrontmatterState(path.join(listDir(root), folder, "issue.md"), to);
  console.log(`→ ${folder}: ${from ?? "(none)"} → ${to}`);
}

function cmdRemove(f: Record<string, string>): void {
  const root = tasksRoot(f);
  if (!f.task || f.task === "true") throw new Error("--task <folder|id> required");
  const folder = findFolder(root, f.task);
  if ((childrenOf(root).get(folder) || []).length && f.cascade !== "true")
    throw new Error(`${folder} has child task(s) — pass --cascade to remove the subtree, or reparent them first`);
  const removeOne = (fld: string): void => {
    for (const c of childrenOf(root).get(fld) || []) removeOne(c); // depth-first
    const st = currentState(root, fld);
    if (st) fs.unlinkSync(path.join(stateDir(root, st), fld)); // unlink the symlink itself; rmSync follows it to the dir
    fs.rmSync(path.join(listDir(root), fld), { recursive: true, force: true });
    console.log(`✗ removed ${fld} (recoverable from git history)`);
  };
  removeOne(folder);
}

function cmdTree(f: Record<string, string>): void {
  const root = tasksRoot(f);
  if (!fs.existsSync(listDir(root))) { console.log("no tasks yet."); return; }
  const kids = childrenOf(root);
  const roots = f.task && f.task !== "true" ? [findFolder(root, f.task)] : sortSiblings(root, kids.get("") || []);
  if (!roots.length) { console.log("(no tasks)"); return; }
  const printNode = (folder: string, depth: number): void => {
    const st = currentState(root, folder) ?? "?";
    const ord = readFm(root, folder).order;
    console.log(`${"  ".repeat(depth)}${depth ? "└─ " : ""}${folder}  [${st}]${ord ? `  ord ${ord}` : ""}`);
    for (const c of sortSiblings(root, kids.get(folder) || [])) printNode(c, depth + 1);
  };
  for (const r of roots) printNode(r, 0);
}

function cmdShow(f: Record<string, string>): void {
  const root = tasksRoot(f);
  const folder = findFolder(root, f.task);   // throws (exit 1) if not found
  const st = currentState(root, folder);
  console.log(`${folder}`);
  console.log(`state: ${st ?? "(none)"}`);
  console.log(`issue: ${path.relative(process.cwd(), path.join(listDir(root), folder, "issue.md"))}`);
}

function cmdList(f: Record<string, string>): void {
  const root = tasksRoot(f);
  if (!fs.existsSync(path.join(root, "by-state"))) { console.log("no tasks yet."); return; }
  const target = normState(f.state) ?? "pending";
  const dir = stateDir(root, target);
  const items = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).sort();
  console.log(`${target} (${items.length}):`);
  for (const it of items) console.log(`  ${it}`);
  if (!items.length) console.log("  (none)");
  const c = counts(root);
  console.log("—");
  console.log(STATES.map((s) => `${s} ${c[s]}`).join("  ·  "));
}

function main(): void {
  process.stdout.on("error", (e: NodeJS.ErrnoException) => { if (e.code === "EPIPE") process.exit(0); });
  const [cmd, ...rest] = process.argv.slice(2);
  const f = args(rest);
  try {
    switch (cmd) {
      case "new": return cmdNew(f);
      case "move": return cmdMove(f);
      case "remove": return cmdRemove(f);
      case "show": return cmdShow(f);
      case "list": return cmdList(f);
      case "tree": return cmdTree(f);
      case "states": console.log(STATES.join("  ")); return;
      default:
        console.error("usage: tasks <new|move|remove|show|list|tree|states> [...]");
        process.exit(1);
    }
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  }
}
main();
