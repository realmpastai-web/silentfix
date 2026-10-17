import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { unpackedPath as unpackedDir, tarballPath as tgzPath } from "./cache.js";
import { verifyIntegrity } from "./integrity.js";
import { unpackTarGzToDir, type UnpackResult } from "./tar.js";
import { httpGetBuffer } from "./http.js";
import type { DistMeta } from "./types.js";

const MARKER_VERSION = 2;

export interface UnpackMeta {
  incomplete: boolean;
  reasons: string[];
  skippedSymlinks: number;
  skippedHardlinks: number;
}

export async function ensureTarball(
  packageName: string,
  version: string,
  dist: DistMeta,
  cacheDir: string,
  opts: {
    offline: boolean;
    fetchTarball?: (url: string) => Promise<Buffer>;
    log?: (m: string) => void;
  },
): Promise<string> {
  const path = tgzPath(cacheDir, packageName, version);
  if (existsSync(path)) {
    const buf = readFileSync(path);
    verifyIntegrity(buf, dist);
    opts.log?.(`cache hit tarball ${packageName}@${version}`);
    return path;
  }
  if (opts.offline) {
    throw new Error(`offline: no cached tarball for ${packageName}@${version}`);
  }
  opts.log?.(`download tarball ${packageName}@${version}`);
  const buf = opts.fetchTarball
    ? await opts.fetchTarball(dist.tarball)
    : (await httpGetBuffer(dist.tarball, { Accept: "application/octet-stream" })).body;
  verifyIntegrity(buf, dist);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  return path;
}

function markerPath(dest: string): string {
  return `${dest}/.silentfix-unpacked`;
}

function parseMarker(raw: string): UnpackMeta | null {
  try {
    const j = JSON.parse(raw) as { v?: number; incomplete?: boolean; reasons?: string[]; skippedSymlinks?: number; skippedHardlinks?: number };
    if (j.v !== MARKER_VERSION) return null;
    return {
      incomplete: Boolean(j.incomplete),
      reasons: Array.isArray(j.reasons) ? j.reasons.map(String) : [],
      skippedSymlinks: Number(j.skippedSymlinks) || 0,
      skippedHardlinks: Number(j.skippedHardlinks) || 0,
    };
  } catch {
    return null;
  }
}

function metaFromResult(result: UnpackResult): UnpackMeta {
  return {
    incomplete: result.incomplete,
    reasons: result.reasons,
    skippedSymlinks: result.skippedSymlinks,
    skippedHardlinks: result.skippedHardlinks,
  };
}

export function ensureUnpacked(
  packageName: string,
  version: string,
  tgzFile: string,
  cacheDir: string,
  log?: (m: string) => void,
): { dest: string; meta: UnpackMeta } {
  const dest = unpackedDir(cacheDir, packageName, version);
  const marker = markerPath(dest);
  if (existsSync(marker)) {
    const meta = parseMarker(readFileSync(marker, "utf8"));
    if (meta) {
      log?.(`cache hit unpacked ${packageName}@${version}`);
      return { dest, meta };
    }
  }
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  mkdirSync(dest, { recursive: true });
  const buf = readFileSync(tgzFile);
  let result: UnpackResult;
  try {
    result = unpackTarGzToDir(buf, dest);
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg);
  }
  const meta = metaFromResult(result);
  writeFileSync(
    marker,
    `${JSON.stringify({
      v: MARKER_VERSION,
      id: `${packageName}@${version}`,
      incomplete: meta.incomplete,
      reasons: meta.reasons,
      skippedSymlinks: meta.skippedSymlinks,
      skippedHardlinks: meta.skippedHardlinks,
    })}\n`,
  );
  return { dest, meta };
}
