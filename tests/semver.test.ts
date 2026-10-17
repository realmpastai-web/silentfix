import { describe, expect, it } from "vitest";
import {
  compareSemver,
  isPrerelease,
  matchesLine,
  satisfiesRange,
  versionLine,
} from "../src/semver.js";

describe("semver helpers", () => {
  it("detects prereleases including calver betas", () => {
    expect(isPrerelease("1.2.3")).toBe(false);
    expect(isPrerelease("1.2.3-beta.1")).toBe(true);
    expect(isPrerelease("2026.10.1-beta.1")).toBe(true);
    expect(isPrerelease("8.17.1")).toBe(false);
  });

  it("assigns 0.x and calver to major.minor lines, others to major", () => {
    expect(versionLine("0.1.10")).toBe("0.1");
    expect(versionLine("8.17.1")).toBe("8");
    expect(versionLine("2026.10.4")).toBe("2026.10");
  });

  it("matches --line specs", () => {
    expect(matchesLine("0.1.10", "0.1")).toBe(true);
    expect(matchesLine("0.1.10", "0.1.x")).toBe(true);
    expect(matchesLine("0.2.0", "0.1")).toBe(false);
    expect(matchesLine("8.17.1", "8")).toBe(true);
    expect(matchesLine("7.5.10", "8")).toBe(false);
  });

  it("satisfies basic ranges", () => {
    expect(satisfiesRange("8.17.1", "^8.17.0")).toBe(true);
    expect(satisfiesRange("9.0.0", "^8.17.0")).toBe(false);
    expect(satisfiesRange("8.17.2", "~8.17.1")).toBe(true);
    expect(satisfiesRange("8.18.0", "~8.17.1")).toBe(false);
    expect(satisfiesRange("0.1.10", "0.1.x")).toBe(true);
  });

  it("compares versions", () => {
    expect(compareSemver("8.17.0", "8.17.1")).toBeLessThan(0);
    expect(compareSemver("1.9.0", "1.9.0")).toBe(0);
  });
});
