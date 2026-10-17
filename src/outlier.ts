import { round4 } from "./score.js";

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid]!;
  return (s[mid - 1]! + s[mid]!) / 2;
}

export function mad(values: number[], med = median(values)): number {
  if (values.length === 0) return 0;
  return median(values.map((v) => Math.abs(v - med)));
}

/**
 * Robust (modified) z-score using median and MAD.
 * z_i = 0.6745 * (x_i - median) / MAD
 * If MAD is 0, fall back to a unit step above the median.
 */
export function robustZScores(values: number[]): number[] {
  if (values.length === 0) return [];
  const med = median(values);
  const m = mad(values, med);
  if (m < 1e-12) {
    return values.map((v) => (v > med + 1e-12 ? 1 : v < med - 1e-12 ? -1 : 0));
  }
  return values.map((v) => round4((0.6745 * (v - med)) / m));
}

export function combinedScore(hardeningDelta: number, outlierScore: number | null): number {
  if (outlierScore === null || !Number.isFinite(outlierScore)) return round4(hardeningDelta);
  return round4(hardeningDelta * (1 + Math.max(0, outlierScore) / 2));
}
