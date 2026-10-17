import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { packumentPath } from "./cache.js";
import { httpGetText } from "./http.js";
import { compareSemver, isPrerelease, matchesLine, satisfiesRange, versionLine } from "./semver.js";
import type { Packument, SelectedVersion } from "./types.js";

export function registryPackumentUrl(packageName: string): string {
  return `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
}

export function parsePackument(raw: unknown, fallbackName: string): Packument {
  if (!raw || typeof raw !== "object") throw new Error("invalid packument");
  const o = raw as Record<string, unknown>;
  const versionsIn = (o.versions ?? {}) as Record<string, unknown>;
  const versions: Packument["versions"] = {};
  for (const [ver, meta] of Object.entries(versionsIn)) {
    if (!meta || typeof meta !== "object") continue;
    const dist = (meta as { dist?: { tarball?: string; integrity?: string; shasum?: string } }).dist;
    if (!dist?.tarball) continue;
    versions[ver] = {
      version: ver,
      dist: {
        tarball: dist.tarball,
        integrity: dist.integrity,
        shasum: dist.shasum,
      },
    };
  }
  const time = (o.time ?? {}) as Record<string, string>;
  return {
    name: typeof o.name === "string" ? o.name : fallbackName,
    versions,
    time,
    "dist-tags": (o["dist-tags"] as Record<string, string> | undefined) ?? undefined,
  };
}

export async function loadPackument(
  packageName: string,
  cacheDir: string,
  opts: {
    offline: boolean;
    fetchPackument?: (pkg: string) => Promise<Packument>;
    log?: (m: string) => void;
  },
): Promise<Packument> {
  const path = packumentPath(cacheDir, packageName);
  if (opts.offline) {
    if (!existsSync(path)) {
      throw new Error(`offline: no cached packument for ${packageName} at ${path}`);
    }
    opts.log?.(`cache hit packument ${packageName}`);
    return parsePackument(JSON.parse(readFileSync(path, "utf8")), packageName);
  }
  if (opts.fetchPackument) {
    const p = await opts.fetchPackument(packageName);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(p, null, 2));
    return p;
  }
  opts.log?.(`fetch packument ${packageName}`);
  const url = registryPackumentUrl(packageName);
  const res = await httpGetText(url, { Accept: "application/json" });
  if (res.status === 404) throw new Error(`package not found: ${packageName}`);
  if (res.status >= 400) throw new Error(`registry error ${res.status} for ${packageName}`);
  const parsed = parsePackument(JSON.parse(res.text), packageName);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, res.text);
  return parsed;
}

export interface SelectOptions {
  last: number;
  includePrerelease: boolean;
  line?: string;
  range?: string;
  around?: string;
  until?: string;
}

export function listedVersions(packument: Packument, opts: SelectOptions): SelectedVersion[] {
  const out: SelectedVersion[] = [];
  for (const [version, meta] of Object.entries(packument.versions)) {
    const published = packument.time[version];
    if (!published) continue;
    if (!opts.includePrerelease && isPrerelease(version)) continue;
    if (opts.line && !matchesLine(version, opts.line)) continue;
    if (opts.range && !satisfiesRange(version, opts.range)) continue;
    out.push({
      version,
      published,
      dist: meta.dist,
      line: versionLine(version),
    });
  }
  out.sort((a, b) => {
    if (a.published < b.published) return -1;
    if (a.published > b.published) return 1;
    return compareSemver(a.version, b.version);
  });
  return out;
}

function windowAround(sorted: SelectedVersion[], around: string, need: number): SelectedVersion[] {
  const idx = sorted.findIndex((v) => v.version === around);
  if (idx < 0) throw new Error(`version not in selected set: ${around}`);
  if (sorted.length <= need) return sorted;
  let start = idx - Math.floor((need - 1) / 2);
  start = Math.max(0, Math.min(start, sorted.length - need));
  let slice = sorted.slice(start, start + need);
  if (slice[0]?.version === around && start > 0) {
    start -= 1;
    slice = sorted.slice(start, start + need);
  }
  return slice;
}

/** Previous published version on the same maintenance line, else the immediate time predecessor. */
export function predecessorOf(sorted: SelectedVersion[], version: string): SelectedVersion | null {
  const idx = sorted.findIndex((v) => v.version === version);
  if (idx <= 0) return null;
  const current = sorted[idx]!;
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (sorted[i]!.line === current.line) return sorted[i]!;
  }
  return sorted[idx - 1]!;
}

export function selectVersionWindow(sorted: SelectedVersion[], opts: SelectOptions): SelectedVersion[] {
  const need = opts.last + 1;
  let list = sorted;
  if (opts.until) {
    const idx = list.findIndex((v) => v.version === opts.until);
    if (idx < 0) throw new Error(`--until version not in selected set: ${opts.until}`);
    list = list.slice(0, idx + 1);
  }
  if (opts.around) return windowAround(list, opts.around, need);
  if (list.length <= need) return list;
  return list.slice(list.length - need);
}
