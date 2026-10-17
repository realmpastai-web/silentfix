import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/parse-args.js";

describe("parseArgs", () => {
  it("defaults last to 20 and reads the package name", () => {
    const opts = parseArgs(["lodash"]);
    expect(opts.packageName).toBe("lodash");
    expect(opts.last).toBe(20);
    expect(opts.offline).toBe(false);
    expect(opts.json).toBe(false);
    expect(opts.includePrerelease).toBe(false);
  });

  it("parses --last and --last=N", () => {
    expect(parseArgs(["ws", "--last", "15"]).last).toBe(15);
    expect(parseArgs(["ws", "--last=7"]).last).toBe(7);
  });

  it("parses line, range, around, until, cache-dir, flags", () => {
    const opts = parseArgs([
      "path-to-regexp",
      "--line",
      "0.1",
      "--range",
      "^0.1.0",
      "--around=0.1.10",
      "--until",
      "0.1.12",
      "--cache-dir",
      "/tmp/c",
      "--offline",
      "--json",
      "--markdown",
      "--include-prerelease",
      "--no-advisories",
      "--advisories-file=./a.json",
    ]);
    expect(opts.line).toBe("0.1");
    expect(opts.range).toBe("^0.1.0");
    expect(opts.around).toBe("0.1.10");
    expect(opts.until).toBe("0.1.12");
    expect(opts.cacheDir).toBe("/tmp/c");
    expect(opts.offline).toBe(true);
    expect(opts.json).toBe(true);
    expect(opts.markdown).toBe(true);
    expect(opts.includePrerelease).toBe(true);
    expect(opts.noAdvisories).toBe(true);
    expect(opts.advisoriesFile).toBe("./a.json");
  });

  it("parses help and version", () => {
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["--version"]).version).toBe(true);
  });

  it("rejects unknown options and bad --last", () => {
    expect(() => parseArgs(["ws", "--nope"])).toThrow(/unknown option/);
    expect(() => parseArgs(["ws", "--last", "0"])).toThrow(/positive integer/);
    expect(() => parseArgs(["ws", "--last", "x"])).toThrow(/positive integer/);
    expect(() => parseArgs(["ws", "extra"])).toThrow(/unexpected arguments/);
  });
});
