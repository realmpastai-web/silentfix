import { createHash } from "node:crypto";
import type { DistMeta } from "./types.js";

export function sha1Hex(buf: Buffer): string {
  return createHash("sha1").update(buf).digest("hex");
}

export function sriMatches(buf: Buffer, integrity: string): boolean {
  const parts = integrity.trim().split(/\s+/);
  for (const part of parts) {
    const m = /^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/=]+)$/.exec(part);
    if (!m) continue;
    const algo = m[1]!;
    const expected = m[2]!;
    const actual = createHash(algo).update(buf).digest("base64");
    if (actual === expected) return true;
  }
  return false;
}

export function verifyIntegrity(buf: Buffer, dist: DistMeta): void {
  if (dist.integrity) {
    if (!sriMatches(buf, dist.integrity)) {
      throw new Error(`integrity mismatch for tarball ${dist.tarball}`);
    }
    return;
  }
  if (dist.shasum) {
    const actual = sha1Hex(buf);
    if (actual !== dist.shasum.toLowerCase()) {
      throw new Error(`shasum mismatch for tarball ${dist.tarball}`);
    }
  }
}

export function integrityOf(buf: Buffer): string {
  return `sha512-${createHash("sha512").update(buf).digest("base64")}`;
}
