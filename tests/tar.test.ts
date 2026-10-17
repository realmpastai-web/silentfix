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
  const r = spawnSync("tar", ["--format", format, "-czf", tgz, "-C", dir, rel], { encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  return readFileSync(tgz);
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
    expect(result.entries.map((e) => e.name).sort()).toEqual(["a.js"]);
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
});

describe("unpackTarGz npm round-trip still works", () => {
  it("strips the package/ prefix", () => {
    const tgz = packNpmPackage([{ name: "index.js", content: "ok\n" }]);
    const result = unpackTarGz(tgz);
    expect(result.incomplete).toBe(false);
    expect(result.entries.map((e) => e.name)).toEqual(["index.js"]);
  });
});
