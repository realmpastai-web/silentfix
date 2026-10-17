import { describe, expect, it } from "vitest";
import { combinedScore, median, robustZScores } from "../src/outlier.js";

describe("outlier score", () => {
  it("marks a lone spike with a high robust z-score", () => {
    const xs = [0.1, 0.12, 0.09, 0.11, 4.5, 0.1, 0.08];
    const z = robustZScores(xs);
    expect(z[4]).toBeGreaterThan(2);
    expect(median(xs)).toBeCloseTo(0.1, 5);
  });

  it("is stable when every value is identical", () => {
    expect(robustZScores([1, 1, 1, 1])).toEqual([0, 0, 0, 0]);
  });

  it("combined score boosts positive outliers only", () => {
    expect(combinedScore(2, 4)).toBeGreaterThan(combinedScore(2, 0));
    expect(combinedScore(2, -3)).toBe(2);
  });
});
