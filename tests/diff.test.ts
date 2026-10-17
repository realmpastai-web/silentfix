import { describe, expect, it } from "vitest";
import { bagDiff } from "../src/diff.js";

describe("bagDiff", () => {
  it("nets moved identical lines to zero", () => {
    const { added, removed } = bagDiff("a\nb\nc\n", "c\na\nb\n");
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });

  it("reports net added and removed lines", () => {
    const { added, removed } = bagDiff("keep\nold\n", "keep\nnew\n");
    expect(added).toEqual(["new"]);
    expect(removed).toEqual(["old"]);
  });
});
