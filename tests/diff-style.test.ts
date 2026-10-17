import { describe, expect, it } from "vitest";
import { styleNormalize } from "../src/diff.js";

describe("styleNormalize", () => {
  it("collapses let/const/var and void 0", () => {
    expect(styleNormalize("  const x = void 0;")).toBe("var x = undefined");
    expect(styleNormalize("let x = 1")).toBe(styleNormalize("const x = 1"));
  });
});
