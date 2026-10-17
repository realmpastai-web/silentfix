import { homedir } from "node:os";
import { join } from "node:path";

export function defaultCacheDir(): string {
  const env = process.env.SILENTFIX_CACHE_DIR;
  if (env && env.trim()) return env.trim();
  return join(homedir(), ".cache", "silentfix");
}

export function cacheKey(packageName: string): string {
  return encodeURIComponent(packageName);
}

export function packumentPath(cacheDir: string, packageName: string): string {
  return join(cacheDir, "packuments", `${cacheKey(packageName)}.json`);
}

export function tarballPath(cacheDir: string, packageName: string, version: string): string {
  return join(cacheDir, "tarballs", cacheKey(packageName), `${version}.tgz`);
}

export function unpackedPath(cacheDir: string, packageName: string, version: string): string {
  return join(cacheDir, "unpacked", cacheKey(packageName), version);
}

export function advisoriesPath(cacheDir: string, packageName: string): string {
  return join(cacheDir, "advisories", `${cacheKey(packageName)}.json`);
}
