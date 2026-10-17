import { gunzipSync, gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";

const BLOCK = 512;

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

export function packTarGz(files: TarEntry[]): Buffer {
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
  return gzipSync(Buffer.concat(chunks));
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

export function unpackTarGz(buf: Buffer): TarEntry[] {
  const data = gunzipSync(buf);
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= data.length) {
    if (isZeroBlock(data, offset)) break;
    const header = data.subarray(offset, offset + BLOCK);
    offset += BLOCK;
    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] ?? 0);
    const prefix = header.toString("utf8", 345, 500).replace(/\0.*$/, "");
    const nameRaw = header.toString("utf8", 0, 100).replace(/\0.*$/, "");
    const name = prefix ? `${prefix.replace(/\0.*$/, "")}/${nameRaw}` : nameRaw;
    const filePad = Math.ceil(size / BLOCK) * BLOCK;
    const content = data.subarray(offset, offset + size);
    offset += filePad;
    if (type === "5" || type === "") {
      continue;
    }
    if (type !== "0" && type !== "\0") {
      continue;
    }
    const rel = safeRelPath(name);
    if (!rel) continue;
    entries.push({ name: rel, content: Buffer.from(content) });
  }
  return entries;
}

export function unpackTarGzToDir(buf: Buffer, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of unpackTarGz(buf)) {
    const abs = join(dest, entry.name.split("/").join(sep));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, entry.content);
  }
}

export function packNpmPackage(files: { name: string; content: string | Buffer }[]): Buffer {
  return packTarGz(
    files.map((f) => ({
      name: `package/${f.name.replace(/\\/g, "/")}`,
      content: Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content),
    })),
  );
}
