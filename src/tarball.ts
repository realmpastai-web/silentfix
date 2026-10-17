import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { unpackedPath as unpackedDir, tarballPath as tgzPath } from "./cache.js";
import { verifyIntegrity } from "./integrity.js";
import { unpackTarGzToDir } from "./tar.js";
import { httpGetBuffer } from "./http.js";
import type { DistMeta } from "./types.js";

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

function unpackWithTarCli(tgz: string, dest: string): boolean {
  mkdirSync(dest, { recursive: true });
  const r = spawnSync(
    "tar",
    ["-xzf", tgz, "-C", dest, "--strip-components=1", "--no-absolute-filenames"],
    { encoding: "utf8" },
  );
  return r.status === 0;
}

export function ensureUnpacked(
  packageName: string,
  version: string,
  tgzFile: string,
  cacheDir: string,
  log?: (m: string) => void,
): string {
  const dest = unpackedDir(cacheDir, packageName, version);
  const marker = `${dest}/.silentfix-unpacked`;
  if (existsSync(marker)) {
    log?.(`cache hit unpacked ${packageName}@${version}`);
    return dest;
  }
  mkdirSync(dest, { recursive: true });
  const ok = unpackWithTarCli(tgzFile, dest);
  if (!ok) {
    const buf = readFileSync(tgzFile);
    unpackTarGzToDir(buf, dest);
  }
  writeFileSync(marker, `${packageName}@${version}\n`);
  return dest;
}
