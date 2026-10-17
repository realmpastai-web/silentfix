import type { Analysis } from "../types.js";

export function formatJson(analysis: Analysis): string {
  return `${JSON.stringify(analysis, null, 2)}\n`;
}
