import { rmSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import { analyze } from "../src/analyze.js";
import { fixture, seedSyntheticCache, tempCache } from "./helpers.js";

const caches: string[] = [];

afterEach(() => {
  for (const dir of caches.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("analyze synthfix fixture", () => {
  it("ranks the hardening release #1 and is deterministic", async () => {
    const cacheDir = tempCache();
    caches.push(cacheDir);
    seedSyntheticCache(cacheDir);

    const run = () =>
      analyze({
        packageName: "synthfix",
        last: 10,
        includePrerelease: false,
        cacheDir,
        offline: true,
        noAdvisories: false,
        advisoriesFile: fixture("synthetic", "advisories-none.json"),
        now: "2020-07-01T00:00:00.000Z",
      });

    const a = await run();
    const b = await run();
    expect(a).toEqual(b);

    const top = a.releases.find((r) => r.rank === 1);
    expect(top?.version).toBe("1.1.1");
    expect(top?.advisoryStatus).toBe("silent-fix candidate");
    expect(top?.hardeningDelta).toBeGreaterThan(0);
    expect(top?.topSignals.length).toBeGreaterThan(0);
    expect(top?.signals.some((s) => s.id === "proto-guard" || s.id === "regex-bound")).toBe(true);
  });

  it("marks 1.1.1 as advisory-fix when the mocked GHSA names it", async () => {
    const cacheDir = tempCache();
    caches.push(cacheDir);
    seedSyntheticCache(cacheDir);
    const a = await analyze({
      packageName: "synthfix",
      last: 10,
      includePrerelease: false,
      cacheDir,
      offline: true,
      noAdvisories: false,
      advisoriesFile: fixture("synthetic", "advisories-fix.json"),
      now: "2020-07-01T00:00:00.000Z",
    });
    const row = a.releases.find((r) => r.version === "1.1.1");
    expect(row?.advisoryStatus).toBe("advisory-fix");
    expect(row?.advisories.map((x) => x.ghsaId)).toEqual(["GHSA-test-xxxx-yyyy"]);
    expect(row?.rank).toBe(1);
  });

  it("emits a stable JSON shape", async () => {
    const cacheDir = tempCache();
    caches.push(cacheDir);
    seedSyntheticCache(cacheDir);
    const a = await analyze({
      packageName: "synthfix",
      last: 5,
      includePrerelease: false,
      cacheDir,
      offline: true,
      noAdvisories: true,
      now: "2020-07-01T00:00:00.000Z",
    });
    expect(a.tool).toBe("silentfix");
    expect(a.toolVersion).toBe("0.1.0");
    expect(a.package).toBe("synthfix");
    expect(a.window.last).toBe(5);
    expect(Array.isArray(a.releases)).toBe(true);
    expect(a.releases.length).toBe(5);
    for (const r of a.releases) {
      expect(r).toEqual(
        expect.objectContaining({
          rank: expect.any(Number),
          version: expect.any(String),
          published: expect.any(String),
          fromVersion: expect.any(String),
          filesChanged: expect.any(Number),
          hardeningDelta: expect.any(Number),
          outlierScore: expect.any(Number),
          combinedScore: expect.any(Number),
          advisoryStatus: expect.stringMatching(/advisory-fix|silent-fix candidate|none/),
          advisories: expect.any(Array),
          signals: expect.any(Array),
          topSignals: expect.any(Array),
        }),
      );
    }
  });
});
