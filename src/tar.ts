import { gunzipSync, gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";

const BLOCK = 512;

/** Decompressed tar may not exceed 256 MiB (gzip-bomb guard). */
export const MAX_GUNZIP_BYTES = 256 * 1024 * 1024;

/** Stop reading after this many real tar members (pax/GNU metadata headers do not count). */
export const TAR_ENTRY_CAP = 20_000;

function readOctal(buf: Buffer, start: number, len: number): number {
  const raw = buf.toString("utf8", start, start + len).replace(/\0.*$/, "").trim();
  if (!raw) return 0;
  return Number.parseInt(raw, 8) || 0;
}

function writeOctal(buf: Buffer, start: number, len: number, value: number): void {
  const s = value.toString(8).padStart(len - 1, "0") + "\0";
  buf.write(s, start, len, "utf8");
}

function headerChecksum(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += header[i]!;
  return sum;
}

function isZeroBlock(buf: Buffer, offset: number): boolean {
  for (let i = 0; i < BLOCK; i += 1) {
    if (buf[offset + i] !== 0) return false;
  }
  return true;
}

export interface TarEntry {
  name: string;
  content: Buffer;
}

export type UnpackFailure = "gzip-bomb" | "gzip";

export interface UnpackResult {
  entries: TarEntry[];
  incomplete: boolean;
  reasons: string[];
  skippedSymlinks: number;
  skippedHardlinks: number;
  failure?: UnpackFailure;
}

function tarHeader(name: string, size: number, type: string): Buffer {
  const buf = Buffer.alloc(BLOCK, 0);
  const nameBuf = Buffer.from(name, "utf8");
  if (nameBuf.length > 99) {
    throw new Error(`tar path too long for ustar header: ${name}`);
  }
  nameBuf.copy(buf, 0);
  writeOctal(buf, 100, 8, 0o644);
  writeOctal(buf, 108, 8, 0);
  writeOctal(buf, 116, 8, 0);
  writeOctal(buf, 124, 12, size);
  writeOctal(buf, 136, 12, 0);
  buf.fill(0x20, 148, 156);
  buf.write(type, 156, 1, "utf8");
  buf.write("ustar\0", 257, 6, "utf8");
  buf.write("00", 263, 2, "utf8");
  const sum = headerChecksum(buf);
  const chk = sum.toString(8).padStart(6, "0") + "\0 ";
  buf.write(chk, 148, 8, "utf8");
  return buf;
}

export function packTar(files: TarEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const file of sorted) {
    const name = file.name.replace(/\\/g, "/").replace(/^\/+/, "");
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
    chunks.push(tarHeader(name, content.length, "0"));
    chunks.push(content);
    const pad = (BLOCK - (content.length % BLOCK)) % BLOCK;
    if (pad) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(chunks);
}

export function packTarGz(files: TarEntry[]): Buffer {
  return gzipSync(packTar(files));
}

function stripPackagePrefix(name: string): string {
  const n = name.replace(/\\/g, "/").replace(/^\.\//, "");
  if (n === "package") return "";
  if (n.startsWith("package/")) return n.slice("package/".length);
  return n;
}

function safeRelPath(name: string): string | null {
  const stripped = stripPackagePrefix(name);
  if (!stripped) return null;
  if (stripped.startsWith("/") || /^[A-Za-z]:/.test(stripped)) return null;
  const norm = normalize(stripped).replace(/\\/g, "/");
  if (norm.split("/").includes("..")) return null;
  if (norm === "." || norm === "") return null;
  return norm;
}

function readCString(buf: Buffer, start: number, len: number): string {
  return buf.toString("utf8", start, start + len).replace(/\0.*$/, "");
}

function nulTerminated(buf: Buffer): string {
  const s = buf.toString("utf8");
  const z = s.indexOf("\0");
  return (z >= 0 ? s.slice(0, z) : s).replace(/\n+$/, "");
}

/** POSIX pax records: `<decimal-length> <keyword>=<value>\\n` (length is in bytes). */
export function parsePaxRecords(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < buf.length) {
    if (buf[i] === 0) break;
    let j = i;
    while (j < buf.length && buf[j]! >= 0x30 && buf[j]! <= 0x39) j += 1;
    if (j === i || j >= buf.length || buf[j] !== 0x20) break;
    const len = Number.parseInt(buf.toString("ascii", i, j), 10);
    if (!Number.isFinite(len) || len < 1 || i + len > buf.length) break;
    const recEnd = i + len;
    const eq = buf.indexOf(0x3d, j + 1);
    if (eq > j && eq < recEnd) {
      const key = buf.toString("utf8", j + 1, eq);
      let valEnd = recEnd;
      if (valEnd > eq + 1 && buf[valEnd - 1] === 0x0a) valEnd -= 1;
      if (key) out[key] = buf.toString("utf8", eq + 1, valEnd);
    }
    i = recEnd;
  }
  return out;
}

function resolveName(
  nameRaw: string,
  prefix: string,
  pax: Record<string, string>,
  gnuLongName: string | null,
): string {
  if (pax.path) return pax.path.replace(/\\/g, "/");
  if (gnuLongName) return gnuLongName.replace(/\\/g, "/");
  return prefix ? `${prefix}/${nameRaw}` : nameRaw;
}

function countReason(n: number, one: string, many: string): string | null {
  if (n === 1) return one;
  if (n > 1) return many.replace("%d", String(n));
  return null;
}

function emptyUnpack(partial: Partial<UnpackResult> & { reasons: string[]; incomplete: boolean }): UnpackResult {
  return {
    entries: [],
    skippedSymlinks: 0,
    skippedHardlinks: 0,
    ...partial,
  };
}

export function unpackTar(data: Buffer): UnpackResult {
  const entries: TarEntry[] = [];
  const reasons: string[] = [];
  let skippedSymlinks = 0;
  let skippedHardlinks = 0;
  let entryCapHit = false;
  let offset = 0;
  let realEntries = 0;
  let globalPax: Record<string, string> = {};
  let nextPax: Record<string, string> = {};
  let nextLongName: string | null = null;

  const takeOverrides = (): { pax: Record<string, string>; longName: string | null } => {
    const pax = { ...globalPax, ...nextPax };
    const longName = nextLongName;
    nextPax = {};
    nextLongName = null;
    return { pax, longName };
  };

  while (offset + BLOCK <= data.length) {
    if (isZeroBlock(data, offset)) break;
    const header = data.subarray(offset, offset + BLOCK);
    const type = String.fromCharCode(header[156] ?? 0);
    const isMetadata = type === "g" || type === "x" || type === "X" || type === "L" || type === "K";
    if (!isMetadata) {
      realEntries += 1;
      if (realEntries > TAR_ENTRY_CAP) {
        entryCapHit = true;
        break;
      }
    }
    offset += BLOCK;
    const size = readOctal(header, 124, 12);
    const prefix = readCString(header, 345, 155);
    const nameRaw = readCString(header, 0, 100);
    if (size < 0 || offset + size > data.length) {
      reasons.push("truncated tar");
      break;
    }
    const content = data.subarray(offset, offset + size);
    const filePad = Math.ceil(size / BLOCK) * BLOCK;
    offset += filePad;

    if (type === "g") {
      globalPax = { ...globalPax, ...parsePaxRecords(content) };
      continue;
    }
    if (type === "x" || type === "X") {
      nextPax = parsePaxRecords(content);
      continue;
    }
    if (type === "L") {
      nextLongName = nulTerminated(content);
      continue;
    }
    if (type === "K") {
      continue;
    }

    const ov = takeOverrides();
    const name = resolveName(nameRaw, prefix, ov.pax, ov.longName);

    if (type === "5") continue;
    if (type === "1") {
      skippedHardlinks += 1;
      continue;
    }
    if (type === "2") {
      skippedSymlinks += 1;
      continue;
    }
    if (type !== "0" && type !== "\0" && type !== "7" && type !== " ") continue;

    const rel = safeRelPath(name);
    if (!rel) continue;
    entries.push({ name: rel, content: Buffer.from(content) });
  }

  if (entryCapHit) reasons.push(`tar entry cap (${TAR_ENTRY_CAP}) reached`);
  const sym = countReason(skippedSymlinks, "skipped 1 symlink", "skipped %d symlinks");
  const hard = countReason(skippedHardlinks, "skipped 1 hard link", "skipped %d hard links");
  if (sym) reasons.push(sym);
  if (hard) reasons.push(hard);

  return {
    entries,
    incomplete: reasons.length > 0,
    reasons,
    skippedSymlinks,
    skippedHardlinks,
  };
}

export function unpackTarGz(buf: Buffer): UnpackResult {
  let data: Buffer;
  try {
    data = gunzipSync(buf, { maxOutputLength: MAX_GUNZIP_BYTES });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
    if (code === "ERR_BUFFER_TOO_LARGE") {
      return emptyUnpack({
        incomplete: true,
        reasons: ["gzip output exceeded 256 MiB"],
        failure: "gzip-bomb",
      });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return emptyUnpack({
      incomplete: true,
      reasons: [`gzip decompress failed: ${msg}`],
      failure: "gzip",
    });
  }
  return unpackTar(data);
}

export function unpackTarGzToDir(buf: Buffer, dest: string): UnpackResult {
  const result = unpackTarGz(buf);
  if (result.failure) {
    throw new Error(result.reasons[0] || "unpack failed");
  }
  mkdirSync(dest, { recursive: true });
  for (const entry of result.entries) {
    const abs = join(dest, entry.name.split("/").join(sep));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, entry.content);
  }
  return result;
}

export function packNpmPackage(files: { name: string; content: string | Buffer }[]): Buffer {
  return packTarGz(
    files.map((f) => ({
      name: `package/${f.name.replace(/\\/g, "/")}`,
      content: Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content),
    })),
  );
}
