import { rmSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import { captureMain, fixture, seedSyntheticCache, tempCache } from "./helpers.js";

const caches: string[] = [];

afterEach(() => {
  for (const dir of caches.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("CLI", () => {
  it("prints help and version", async () => {
    const h = await captureMain(["--help"]);
    expect(h.code).toBe(0);
    expect(h.stdout).toMatch(/silentfix/);
    expect(h.stdout).toMatch(/--last/);
    const v = await captureMain(["--version"]);
    expect(v.code).toBe(0);
    expect(v.stdout.trim()).toBe("0.1.0");
  });

  it("errors on missing package and unknown flags", async () => {
    const missing = await captureMain([]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/missing package name/);
    const unknown = await captureMain(["foo", "--nope"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/unknown option/);
  });

  it("runs offline against the synthetic cache and prints JSON", async () => {
    const cacheDir = tempCache();
    caches.push(cacheDir);
    seedSyntheticCache(cacheDir);
    const r = await captureMain([
      "synthfix",
      "--offline",
      "--cache-dir",
      cacheDir,
      "--advisories-file",
      fixture("synthetic", "advisories-none.json"),
      "--json",
      "--last",
      "5",
    ]);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout) as {
      package: string;
      releases: { rank: number; version: string; advisoryStatus: string }[];
    };
    expect(report.package).toBe("synthfix");
    expect(report.releases[0]?.version).toBe("1.1.1");
    expect(report.releases[0]?.rank).toBe(1);
    expect(report.releases[0]?.advisoryStatus).toBe("silent-fix candidate");
  });

  it("prints a terminal table offline", async () => {
    const cacheDir = tempCache();
    caches.push(cacheDir);
    seedSyntheticCache(cacheDir);
    const r = await captureMain([
      "synthfix",
      "--offline",
      "--cache-dir",
      cacheDir,
      "--no-advisories",
      "--last",
      "5",
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/silentfix/);
    expect(r.stdout).toMatch(/1\.1\.1/);
    expect(r.stdout).toMatch(/delta/);
  });

  it("fails closed when offline cache is empty", async () => {
    const cacheDir = tempCache();
    caches.push(cacheDir);
    const r = await captureMain(["no-such-pkg", "--offline", "--cache-dir", cacheDir]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/offline/);
  });
});
