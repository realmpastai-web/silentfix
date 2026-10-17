import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import type { DiffResult, FileChange } from "./types.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "__pycache__",
  ".silentfix-unpacked",
]);

const SOURCE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"]);

const SKIP_EXT = new Set([
  ".map",
  ".md",
  ".markdown",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".wasm",
  ".lock",
]);

export function isSourceFile(rel: string): boolean {
  const ext = extname(rel).toLowerCase();
  if (SKIP_EXT.has(ext)) return false;
  if (rel.endsWith(".d.ts")) return false;
  if (rel.endsWith(".min.js")) return false;
  const base = rel.split(/[/\\]/).pop() ?? rel;
  if (base === "LICENSE" || base === "LICENCE") return false;
  return SOURCE_EXT.has(ext) || base === "package.json";
}

export function isChangelog(rel: string): boolean {
  const base = (rel.split(/[/\\]/).pop() ?? rel).toLowerCase();
  return base === "changelog.md" || base === "changelog" || base === "history.md";
}

function walkFiles(root: string, dir = root, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    if (name === ".silentfix-unpacked") continue;
    const abs = join(dir, name);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walkFiles(root, abs, out);
    else if (st.isFile()) out.push(relative(root, abs).split(sep).join("/"));
  }
  return out;
}

const MAX_SOURCE_BYTES = 1_500_000;

function readText(root: string, rel: string): string | null {
  try {
    const buf = readFileSync(join(root, rel));
    if (buf.length > MAX_SOURCE_BYTES) return null;
    if (buf.includes(0)) return null;
    return buf.toString("utf8").replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}

/** Collapse let/const/var and void 0 so formatting churn does not dominate size. */
export function styleNormalize(line: string): string {
  return line
    .replace(/\bvoid 0\b/g, "undefined")
    .replace(/\b(const|let|var)\b/g, "var")
    .replace(/,(\s*[}\]])/g, "$1")
    .replace(/;+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isVersionField(line: string): boolean {
  return /^\s*"version"\s*:/.test(line);
}

export function bagDiff(oldText: string, newText: string): { added: string[]; removed: string[] } {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const oldM = new Map<string, number>();
  const newM = new Map<string, number>();
  for (const l of oldLines) oldM.set(l, (oldM.get(l) ?? 0) + 1);
  for (const l of newLines) newM.set(l, (newM.get(l) ?? 0) + 1);
  const added: string[] = [];
  const removed: string[] = [];
  const keys = new Set<string>([...oldM.keys(), ...newM.keys()]);
  const sorted = [...keys].sort();
  for (const k of sorted) {
    const o = oldM.get(k) ?? 0;
    const n = newM.get(k) ?? 0;
    for (let i = 0; i < n - o; i += 1) added.push(k);
    for (let i = 0; i < o - n; i += 1) removed.push(k);
  }
  return { added, removed };
}

export function diffTrees(oldRoot: string, newRoot: string): DiffResult {
  const oldFiles = new Set(walkFiles(oldRoot));
  const newFiles = new Set(walkFiles(newRoot));
  const all = [...new Set([...oldFiles, ...newFiles])].sort();
  const files: FileChange[] = [];
  const addedSourceLines: string[] = [];
  const removedSourceLines: string[] = [];
  const addedSourcePaths: string[] = [];
  const changelogAdded: string[] = [];
  let packageJsonAdded: string | undefined;
  let packageJsonRemoved: string | undefined;
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const rel of all) {
    const inOld = oldFiles.has(rel);
    const inNew = newFiles.has(rel);
    const source = isSourceFile(rel);
    const changelog = isChangelog(rel);
    if (!source && !changelog) {
      if (inOld !== inNew) {
        files.push({
          path: rel,
          kind: inNew ? "add" : "remove",
          linesAdded: 0,
          linesRemoved: 0,
        });
      }
      continue;
    }
    const oldText = inOld ? readText(oldRoot, rel) : "";
    const newText = inNew ? readText(newRoot, rel) : "";
    if (oldText === null || newText === null) continue;
    if (inOld && inNew && oldText === newText) continue;
    const kind: FileChange["kind"] = !inOld ? "add" : !inNew ? "remove" : "modify";
    const { added, removed } = bagDiff(oldText ?? "", newText ?? "");
    const size = bagDiff(
      (oldText ?? "")
        .split("\n")
        .filter((l) => !isVersionField(l))
        .map(styleNormalize)
        .join("\n"),
      (newText ?? "")
        .split("\n")
        .filter((l) => !isVersionField(l))
        .map(styleNormalize)
        .join("\n"),
    );
    files.push({
      path: rel,
      kind,
      linesAdded: added.length,
      linesRemoved: removed.length,
    });
    if (changelog) {
      changelogAdded.push(...added);
      continue;
    }
    linesAdded += size.added.length;
    linesRemoved += size.removed.length;
    addedSourceLines.push(...added);
    removedSourceLines.push(...removed);
    if (kind === "add") addedSourcePaths.push(rel);
    const base = rel.split("/").pop();
    if (base === "package.json") {
      packageJsonAdded = newText ?? "";
      packageJsonRemoved = oldText ?? "";
    }
  }

  return {
    filesChanged: files.length,
    linesAdded,
    linesRemoved,
    files,
    addedSourceLines,
    removedSourceLines,
    addedSourcePaths,
    packageJsonAdded,
    packageJsonRemoved,
    changelogAdded,
  };
}
