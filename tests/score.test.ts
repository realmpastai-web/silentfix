import { describe, expect, it } from "vitest";
import { bagDiff } from "../src/diff.js";
import { scoreDiff } from "../src/score.js";
import type { DiffResult } from "../src/types.js";

function diffFrom(oldSrc: string, newSrc: string): DiffResult {
  const { added, removed } = bagDiff(oldSrc, newSrc);
  return {
    filesChanged: 1,
    linesAdded: added.length,
    linesRemoved: removed.length,
    files: [
      {
        path: "index.js",
        kind: "modify",
        linesAdded: added.length,
        linesRemoved: removed.length,
      },
    ],
    addedSourceLines: added,
    removedSourceLines: removed,
    addedSourcePaths: [],
    changelogAdded: [],
  };
}

describe("Hardening Delta", () => {
  it("scores a regex bound + prototype-pollution guard above a rename", () => {
    const vuln = `module.exports.merge = function (a, b) {
  for (const k of Object.keys(b)) a[k] = b[k];
  return a;
};
module.exports.parse = function (s) { return new RegExp(s + ".*"); };
`;
    const fix = `const MAX_LEN = 32;
module.exports.merge = function (a, b) {
  const out = Object.create(null);
  for (const k of Object.keys(b)) {
    if (k === "__proto__" || k === "constructor") continue;
    out[k] = b[k];
  }
  return out;
};
module.exports.parse = function (s) {
  if (s.length > MAX_LEN) throw new TypeError("bad");
  return new RegExp(s.replace(/\\*/g, ".{0,8}"));
};
`;
    const rename = `module.exports.mergeValues = function (a, b) {
  for (const k of Object.keys(b)) a[k] = b[k];
  return a;
};
module.exports.parsePattern = function (s) { return new RegExp(s + ".*"); };
`;
    const hFix = scoreDiff(diffFrom(vuln, fix));
    const hRename = scoreDiff(diffFrom(vuln, rename));
    expect(hFix.hardeningDelta).toBeGreaterThan(hRename.hardeningDelta);
    expect(hFix.signals.some((s) => s.id === "proto-guard")).toBe(true);
    expect(hFix.signals.some((s) => s.id === "regex-bound" || s.id === "max-limit")).toBe(true);
  });

  it("is deterministic", () => {
    const a = "foo\nbar\n";
    const b = 'if (k === "__proto__") throw new TypeError("no");\nfoo\n';
    const d = diffFrom(a, b);
    const s1 = scoreDiff(d);
    const s2 = scoreDiff(d);
    expect(s1).toEqual(s2);
  });

  it("penalizes large diffs relative to the same signals", () => {
    const guard = 'if (x === "__proto__") return;\n';
    const small = diffFrom("a\n", `a\n${guard}`);
    const padding = Array.from({ length: 400 }, (_, i) => `const x${i} = ${i};`).join("\n");
    const large = diffFrom("a\n", `a\n${guard}${padding}\n`);
    const hs = scoreDiff(small).hardeningDelta;
    const hl = scoreDiff(large).hardeningDelta;
    expect(hs).toBeGreaterThan(hl);
  });
});
