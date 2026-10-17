import { describe, expect, it } from "vitest";
import { formatMarkdown } from "../src/report/markdown.js";
import { formatTerminal } from "../src/report/terminal.js";
import type { Analysis, RankedRelease } from "../src/types.js";

function release(partial: Partial<RankedRelease>): RankedRelease {
  return {
    rank: 1,
    version: "1.0.0",
    published: "2020-01-01T00:00:00.000Z",
    fromVersion: "0.9.0",
    filesChanged: 1,
    linesAdded: 1,
    linesRemoved: 0,
    hardeningDelta: 1.25,
    outlierScore: null,
    combinedScore: 1.25,
    advisoryStatus: "none",
    advisories: [],
    signals: [],
    topSignals: [],
    incomplete: true,
    skipReasons: ["skipped 1 symlink"],
    ...partial,
  };
}

function analysis(partial: Partial<Analysis> = {}): Analysis {
  return {
    tool: "silentfix",
    toolVersion: "0.1.0",
    package: "demo",
    generatedAt: "2020-07-01T00:00:00.000Z",
    cacheDir: "/tmp/cache",
    offline: true,
    window: {
      last: 3,
      includePrerelease: false,
      line: null,
      range: null,
      around: null,
      until: null,
      versionsConsidered: 4,
      versionsScored: 3,
    },
    advisoriesFetched: false,
    incomplete: true,
    incompleteReasons: ["1.0.0: skipped 1 symlink"],
    lowHistory: true,
    releases: [release({})],
    ...partial,
  };
}

describe("reports", () => {
  it("carries incomplete, low-history, and null z into markdown", () => {
    const md = formatMarkdown(analysis());
    expect(md).toMatch(/Low-history/);
    expect(md).toMatch(/Incomplete:/);
    expect(md).toMatch(/skipped 1 symlink/);
    expect(md).toMatch(/n\/a/);
    expect(md).toMatch(/1\.0\.0/);
  });

  it("carries incomplete, low-history, and null z into the terminal table", () => {
    const text = formatTerminal(analysis());
    expect(text).toMatch(/low-history/);
    expect(text).toMatch(/incomplete:/);
    expect(text).toMatch(/skipped 1 symlink/);
    expect(text).toMatch(/n\/a/);
  });
});
