import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { integrityOf, sha1Hex } from "../src/integrity.js";
import { packNpmPackage } from "../src/tar.js";
import { packumentPath, tarballPath } from "../src/cache.js";
import type { Packument } from "../src/types.js";

export const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const FIXTURES = join(REPO, "fixtures");
export const SYNTHETIC = join(FIXTURES, "synthetic");

export const SYNTHETIC_VERSIONS = ["1.0.0", "1.0.1", "1.1.0", "1.1.1", "1.2.0", "1.2.1"] as const;

export function fixture(...parts: string[]): string {
  return join(FIXTURES, ...parts);
}

function listVersionFiles(versionDir: string, rel = ""): { name: string; content: Buffer }[] {
  const dir = rel ? join(versionDir, rel) : versionDir;
  const out: { name: string; content: Buffer }[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${name.name}` : name.name;
    if (name.isDirectory()) out.push(...listVersionFiles(versionDir, childRel));
    else if (name.isFile()) {
      out.push({ name: childRel, content: readFileSync(join(versionDir, childRel)) });
    }
  }
  return out;
}

export function packVersionTarball(version: string): Buffer {
  const dir = join(SYNTHETIC, "versions", version);
  return packNpmPackage(listVersionFiles(dir));
}

export function seedSyntheticCache(cacheDir: string, packageName = "synthfix"): Packument {
  const times: Record<string, string> = {
    "1.0.0": "2020-01-01T00:00:00.000Z",
    "1.0.1": "2020-02-01T00:00:00.000Z",
    "1.1.0": "2020-03-01T00:00:00.000Z",
    "1.1.1": "2020-04-01T00:00:00.000Z",
    "1.2.0": "2020-05-01T00:00:00.000Z",
    "1.2.1": "2020-06-01T00:00:00.000Z",
  };
  const packument: Packument = {
    name: packageName,
    versions: {},
    time: { created: "2020-01-01T00:00:00.000Z", modified: "2020-06-01T00:00:00.000Z", ...times },
  };
  for (const version of SYNTHETIC_VERSIONS) {
    const buf = packVersionTarball(version);
    const path = tarballPath(cacheDir, packageName, version);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buf);
    packument.versions[version] = {
      version,
      dist: {
        tarball: `file://${path}`,
        integrity: integrityOf(buf),
        shasum: sha1Hex(buf),
      },
    };
  }
  const pPath = packumentPath(cacheDir, packageName);
  mkdirSync(dirname(pPath), { recursive: true });
  writeFileSync(pPath, JSON.stringify(packument, null, 2));
  return packument;
}

export function tempCache(): string {
  return mkdtempSync(join(tmpdir(), "silentfix-cache-"));
}

export async function captureMain(args: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const { main } = await import("../src/cli.js");
  const stdout: string[] = [];
  const stderr: string[] = [];
  const ow = process.stdout.write.bind(process.stdout);
  const ew = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const code = await main(args);
    return { code, stdout: stdout.join(""), stderr: stderr.join("") };
  } finally {
    process.stdout.write = ow;
    process.stderr.write = ew;
  }
}

