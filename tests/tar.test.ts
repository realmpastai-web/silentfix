import { createGzip } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, afterEach } from "vitest";
import {
  MAX_GUNZIP_BYTES,
  TAR_ENTRY_CAP,
  packNpmPackage,
  packTar,
  unpackTar,
  unpackTarGz,
} from "../src/tar.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "silentfix-tar-"));
  temps.push(dir);
  return dir;
}

function tarCreate(dir: string, format: "pax" | "gnu" | "ustar", rel = "package"): Buffer {
  const tgz = join(dir, `${format}.tgz`);
  const r = spawnSync("tar", ["--format", format, "--sort=name", "-czf", tgz, "-C", dir, rel], {
    encoding: "utf8",
  });
  expect(r.status, r.stderr).toBe(0);
  return readFileSync(tgz);
}

const BLOCK = 512;

function writeOctal(buf: Buffer, start: number, len: number, value: number): void {
  const s = value.toString(8).padStart(len - 1, "0") + "\0";
  buf.write(s, start, len, "utf8");
}

/** Minimal ustar header for tests that need pax/GNU metadata members. */
function ustarHeader(name: string, size: number, type: string): Buffer {
  const buf = Buffer.alloc(BLOCK, 0);
  Buffer.from(name, "utf8").copy(buf, 0);
  writeOctal(buf, 100, 8, 0o644);
  writeOctal(buf, 108, 8, 0);
  writeOctal(buf, 116, 8, 0);
  writeOctal(buf, 124, 12, size);
  writeOctal(buf, 136, 12, 0);
  buf.fill(0x20, 148, 156);
  buf.write(type, 156, 1, "utf8");
  buf.write("ustar\0", 257, 6, "utf8");
  buf.write("00", 263, 2, "utf8");
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += buf[i]!;
  buf.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
  return buf;
}

async function gzipZeros(bytes: number): Promise<Buffer> {
  const gz = createGzip({ level: 9 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    gz.on("data", (d: Buffer) => chunks.push(d));
    gz.on("end", () => resolve(Buffer.concat(chunks)));
    gz.on("error", reject);
  });
  const chunk = Buffer.alloc(1024 * 1024, 0);
  let left = bytes;
  function pump(): void {
    while (left > 0) {
      const n = Math.min(left, chunk.length);
      left -= n;
      const slice = n === chunk.length ? chunk : chunk.subarray(0, n);
      if (!gz.write(slice)) {
        gz.once("drain", pump);
        return;
      }
    }
    gz.end();
  }
  pump();
  return done;
}

describe("unpackTarGz pax/GNU long paths", () => {
  it("keeps a 150+ char pax path and the .js extension", () => {
    const dir = tempDir();
    const a = "a".repeat(70);
    const b = "b".repeat(70);
    const nested = join(dir, "package", a, b);
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "index.js"), "module.exports=1;\n");
    const tgz = tarCreate(dir, "pax");
    const result = unpackTarGz(tgz);
    const names = result.entries.map((e) => e.name);
    const hit = names.find((n) => n.endsWith("index.js"));
    expect(hit, `entries: ${names.join(",")}`).toBeDefined();
    expect(hit!.length).toBeGreaterThanOrEqual(150);
    expect(hit).toBe(`${a}/${b}/index.js`);
    expect(result.entries.find((e) => e.name === hit)?.content.toString()).toContain("module.exports");
  });

  it("applies GNU L longname to the next entry", () => {
    const dir = tempDir();
    const a = "c".repeat(80);
    const b = "d".repeat(80);
    const nested = join(dir, "package", a, b);
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "index.js"), "module.exports=2;\n");
    const tgz = tarCreate(dir, "gnu");
    const result = unpackTarGz(tgz);
    const names = result.entries.map((e) => e.name);
    const hit = names.find((n) => n.endsWith("index.js"));
    expect(hit, `entries: ${names.join(",")}`).toBeDefined();
    expect(hit!.length).toBeGreaterThanOrEqual(150);
    expect(hit).toBe(`${a}/${b}/index.js`);
  });
});

describe("unpackTarGz gzip bound", () => {
  it("skips gzip bombs at 256 MiB with a skip reason", async () => {
    const bomb = await gzipZeros(MAX_GUNZIP_BYTES + 4096);
    const result = unpackTarGz(bomb);
    expect(result.failure).toBe("gzip-bomb");
    expect(result.incomplete).toBe(true);
    expect(result.entries).toEqual([]);
    expect(result.reasons.some((r) => /gzip output exceeded 256 MiB/.test(r))).toBe(true);
  }, 20_000);
});

describe("unpackTar links and entry cap", () => {
  it("counts skipped symlink and hard-link entries and marks incomplete", () => {
    const dir = tempDir();
    const pkg = join(dir, "package");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "a.js"), "hello\n");
    linkSync(join(pkg, "a.js"), join(pkg, "b.js"));
    symlinkSync("a.js", join(pkg, "c.js"));
    const tgz = tarCreate(dir, "ustar");
    const result = unpackTarGz(tgz);
    expect(result.skippedHardlinks).toBe(1);
    expect(result.skippedSymlinks).toBe(1);
    expect(result.incomplete).toBe(true);
    expect(result.reasons).toEqual(expect.arrayContaining(["skipped 1 symlink", "skipped 1 hard link"]));
    // GNU tar stores the first hard-linked name as a regular file; --sort=name
    // makes that a.js, but assert by count so a directory-order swap cannot flake.
    expect(result.entries).toHaveLength(1);
    expect(["a.js", "b.js"]).toContain(result.entries[0]!.name);
    expect(result.entries[0]!.content.toString()).toBe("hello\n");
  });

  it("caps at 20,000 entries and reports incomplete", () => {
    const n = TAR_ENTRY_CAP + 1;
    const files = Array.from({ length: n }, (_, i) => ({
      name: `package/f${String(i).padStart(5, "0")}.js`,
      content: Buffer.from("x"),
    }));
    const result = unpackTar(packTar(files));
    expect(result.entries.length).toBe(TAR_ENTRY_CAP);
    expect(result.incomplete).toBe(true);
    expect(result.reasons.some((r) => r.includes("tar entry cap (20000)"))).toBe(true);
  }, 60_000);

  it("does not count pax/GNU metadata headers toward the entry cap", () => {
    const x = ustarHeader("./PaxHeaders", 0, "x");
    const gnuL = ustarHeader("././@LongLink", 0, "L");
    const g = ustarHeader("./PaxHeaders.g", 0, "g");
    const metas = Array.from({ length: TAR_ENTRY_CAP }, (_, i) => (i % 3 === 0 ? g : i % 3 === 1 ? gnuL : x));
    const body = packTar([{ name: "package/kept.js", content: Buffer.from("ok\n") }]);
    const result = unpackTar(Buffer.concat([...metas, body]));
    expect(result.entries.map((e) => e.name)).toEqual(["kept.js"]);
    expect(result.entries[0]!.content.toString()).toBe("ok\n");
    expect(result.reasons.some((r) => r.includes("tar entry cap"))).toBe(false);
    expect(result.incomplete).toBe(false);
  }, 60_000);
});

describe("unpackTarGz npm round-trip still works", () => {
  it("strips the package/ prefix", () => {
    const tgz = packNpmPackage([{ name: "index.js", content: "ok\n" }]);
    const result = unpackTarGz(tgz);
    expect(result.incomplete).toBe(false);
    expect(result.entries.map((e) => e.name)).toEqual(["index.js"]);
  });
});
