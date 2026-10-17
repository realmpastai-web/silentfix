import type { DiffResult, ScoreResult, SignalHit } from "./types.js";

export interface HardeningRule {
  id: string;
  label: string;
  weight: number;
  /** Test against a single source line (added or removed). */
  test: (line: string) => boolean;
}

const MAX_HITS = 8;
const MAX_EVIDENCE = 3;

function rx(re: RegExp): (line: string) => boolean {
  return (line: string) => {
    re.lastIndex = 0;
    return re.test(line);
  };
}

/**
 * Deterministic hardening signals. Weights are documented in docs/method.md.
 * Never keyed on package name or version.
 */
export const HARDENING_RULES: HardeningRule[] = [
  {
    id: "regex-bound",
    label: "bounded regex quantifier",
    weight: 14,
    test: rx(/\{[0-9]+,[0-9]{1,6}\}|(\.|\[(?:\\.|[^\]\\])+\])\{\s*0\s*,\s*\d+/),
  },
  {
    id: "backtrack-guard",
    label: "backtracking / ReDoS guard",
    weight: 12,
    test: rx(/\bbacktrack(?:ing)?\b|\bredos\b|catastrophic backtracking|\(\?\!/),
  },
  {
    id: "proto-guard",
    label: "prototype-pollution guard",
    weight: 12,
    test: rx(/__proto__/),
  },
  {
    id: "constructor-key",
    label: "constructor key guard",
    weight: 8,
    test: rx(/===?\s*['"]constructor['"]|['"]constructor['"]\s*===?|\[['\"]constructor['\"]\]/),
  },
  {
    id: "prototype-key",
    label: "prototype key guard",
    weight: 6,
    test: rx(/===?\s*['"]prototype['"]|['"]prototype['"]\s*===?|\.constructor\.prototype/),
  },
  {
    id: "null-object",
    label: "null-prototype object",
    weight: 8,
    test: rx(/Object\.create\(\s*null\s*\)/),
  },
  {
    id: "has-own",
    label: "own-property check",
    weight: 5,
    test: rx(/Object\.hasOwn\b|\.hasOwnProperty\b|Object\.prototype\.hasOwnProperty/),
  },
  {
    id: "max-limit",
    label: "max/size/limit constant",
    weight: 8,
    test: rx(
      /\bMAX_[A-Z0-9_]+\b|\b[A-Z][A-Z0-9]*(?:_SIZE|_LEN(?:GTH)?|_LIMIT|_COUNT|_DEPTH|_BYTES|_HEADERS)\b|\bmax(?:Length|Size|Count|Bytes|Headers|Payload|Depth|BufferedChunks|Fragments|Age)\b/,
    ),
  },
  {
    id: "length-check",
    label: "length/bounds check",
    weight: 6,
    test: rx(/\.(?:length|byteLength)\s*[<>=]=?|\blength\s*[<>=]=?\s*\w/),
  },
  {
    id: "throw-validation",
    label: "throw on bad input",
    weight: 6,
    test: rx(/throw\s+new\s+(TypeError|RangeError|SyntaxError|Error|URIError)\b/),
  },
  {
    id: "undef-guard",
    label: "null/undefined input guard",
    weight: 5,
    test: rx(/===?\s*undefined|!==?\s*undefined|==\s*null|!=\s*null/),
  },
  {
    id: "path-normalize",
    label: "path traversal / normalize",
    weight: 8,
    test: rx(/path\.(?:normalize|resolve)\b|includes\(\s*['"]\.\.['"]\)|['"]\.\.\/['"]|startsWith\(\s*(?:root|base)/),
  },
  {
    id: "escape-sanitize",
    label: "escape / sanitize",
    weight: 6,
    test: rx(/\b(?:escapeHtml|htmlEscape|sanitize|encodeURIComponent|encodeURI)\b/),
  },
  {
    id: "split-limit",
    label: "split with limit",
    weight: 4,
    test: rx(/\.split\(\s*[^,)]+\s*,\s*\d+/),
  },
  {
    id: "depth-guard",
    label: "recursion / depth limit",
    weight: 6,
    test: rx(/\b(?:maxDepth|MAX_DEPTH)\b|\bdepth\s*[<>=]=?/),
  },
  {
    id: "regex-touch",
    label: "regular expression change",
    weight: 7,
    test: (line) => /\/(?:\\.|[^/\n])+\/[gimsuy]*|\bnew\s+RegExp\s*\(/.test(line),
  },
  {
    id: "security-comment",
    label: "security comment",
    weight: 4,
    test: rx(/\b(?:cve-|ghsa-|prototype pollution|path traversal|injection|denial of service|\bdos\b|\bsecurity\b)/i),
  },
  {
    id: "header-validate",
    label: "header / request validation",
    weight: 5,
    test: rx(/\b(?:headers?\.(?:upgrade|authorization|host)|sec-websocket|abortHandshake|invalid (?:upgrade|header))/i),
  },
];

const TEST_PATH = /(^|\/)(test|tests|__tests__|spec)(\/|$)|[._-](test|spec)\.[cm]?[jt]sx?$/i;
const TEST_KEYWORDS =
  /\b(?:security|prototype pollution|redos|re-?dos|path traversal|injection|overflow|dos|sanitize|__proto__|pollut)/i;

function hitsOn(lines: string[], rule: HardeningRule): { hits: number; evidence: string[] } {
  let hits = 0;
  const evidence: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!rule.test(trimmed)) continue;
    hits += 1;
    if (evidence.length < MAX_EVIDENCE) evidence.push(trimmed.slice(0, 160));
    if (hits >= MAX_HITS) break;
  }
  return { hits, evidence };
}

function depBumpScore(oldJson: string | undefined, newJson: string | undefined): number {
  if (!oldJson || !newJson || oldJson === newJson) return 0;
  let oldP: Record<string, unknown>;
  let newP: Record<string, unknown>;
  try {
    oldP = JSON.parse(oldJson) as Record<string, unknown>;
    newP = JSON.parse(newJson) as Record<string, unknown>;
  } catch {
    return 0;
  }
  const sections = ["dependencies", "optionalDependencies", "peerDependencies"] as const;
  let score = 0;
  for (const key of sections) {
    const o = (oldP[key] ?? {}) as Record<string, string>;
    const n = (newP[key] ?? {}) as Record<string, string>;
    for (const [name, nv] of Object.entries(n)) {
      const ov = o[name];
      if (!ov || ov === nv) continue;
      // Patch-level bumps are the usual silent security-dep pattern; keep this small.
      const a = ov.replace(/^[~^]/, "");
      const b = nv.replace(/^[~^]/, "");
      const pa = a.split(".");
      const pb = b.split(".");
      if (pa[0] === pb[0] && pa[1] === pb[1] && pa[2] !== pb[2]) score += 1.5;
      else if (pa[0] === pb[0]) score += 1;
      else score += 0.5;
    }
  }
  return Math.min(3, score);
}

function changelogScore(lines: string[]): { raw: number; evidence: string[] } {
  const evidence: string[] = [];
  let hits = 0;
  for (const line of lines) {
    if (!/security|cve-|ghsa-|prototype pollution|redos|vulnerab/i.test(line)) continue;
    hits += 1;
    if (evidence.length < MAX_EVIDENCE) evidence.push(line.trim().slice(0, 160));
    if (hits >= 4) break;
  }
  return { raw: hits * 3, evidence };
}

function evalSimpleProduct(expr: string): number | null {
  const parts = expr.split("*").map((p) => Number(p.trim()));
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((a, b) => a * b, 1);
}

function maxNumericValues(lines: string[]): number[] {
  const out: number[] = [];
  for (const line of lines) {
    if (!/\bMAX_[A-Z0-9_]+\b|\bmax(?:Length|Size|Count|Bytes|Headers|Payload|Depth)\b/.test(line)) continue;
    const m = line.match(/(?::|=)\s*([0-9][0-9.*\s]*)/);
    if (!m) continue;
    const n = evalSimpleProduct(m[1]!.trim().replace(/[,;].*$/, ""));
    if (n !== null) out.push(n);
  }
  return out;
}

function limitTightenBonus(added: string[], removed: string[]): number {
  const a = maxNumericValues(added);
  const r = maxNumericValues(removed);
  if (!a.length || !r.length) return 0;
  const newMin = Math.min(...a);
  const oldMin = Math.min(...r);
  if (newMin < oldMin && oldMin > 0) return 16;
  return 0;
}

function testFileBonus(paths: string[], addedLines: string[]): number {
  const testAdded = paths.some((p) => TEST_PATH.test(p));
  if (!testAdded) {
    // Modified test files still contribute via added lines.
  }
  let hits = 0;
  for (const line of addedLines) {
    if (TEST_KEYWORDS.test(line)) hits += 1;
    if (hits >= 4) break;
  }
  if (hits === 0) return 0;
  return Math.min(8, 4 + hits);
}

/**
 * Hardening Delta H = raw / log2(2 + added + removed)
 * raw = sum_k weight_k * max(0, hits_added_k - 0.5 * hits_removed_k) plus small extras.
 */
export function scoreDiff(diff: DiffResult): ScoreResult {
  const signals: SignalHit[] = [];
  let raw = 0;

  for (const rule of HARDENING_RULES) {
    const add = hitsOn(diff.addedSourceLines, rule);
    const rem = hitsOn(diff.removedSourceLines, rule);
    const net = Math.max(0, add.hits - 0.5 * rem.hits);
    if (net <= 0) continue;
    const contribution = rule.weight * net;
    raw += contribution;
    signals.push({
      id: rule.id,
      label: rule.label,
      weight: rule.weight,
      hits: add.hits,
      contribution: round4(contribution),
      evidence: add.evidence,
    });
  }

  const tighten = limitTightenBonus(diff.addedSourceLines, diff.removedSourceLines);
  if (tighten > 0) {
    raw += tighten;
    signals.push({
      id: "limit-tighten",
      label: "tightened numeric limit",
      weight: 16,
      hits: 1,
      contribution: round4(tighten),
      evidence: [],
    });
  }

  const dep = depBumpScore(diff.packageJsonRemoved, diff.packageJsonAdded);
  if (dep > 0) {
    raw += dep;
    signals.push({
      id: "dep-bump",
      label: "dependency patch/minor bump",
      weight: dep,
      hits: 1,
      contribution: round4(dep),
      evidence: [],
    });
  }

  const cl = changelogScore(diff.changelogAdded);
  if (cl.raw > 0) {
    raw += cl.raw;
    signals.push({
      id: "changelog-security",
      label: "changelog security mention",
      weight: 3,
      hits: cl.evidence.length,
      contribution: round4(cl.raw),
      evidence: cl.evidence,
    });
  }

  const testBonus = testFileBonus(diff.addedSourcePaths, diff.addedSourceLines);
  if (testBonus > 0 && TEST_KEYWORDS.test(diff.addedSourceLines.join("\n"))) {
    raw += testBonus;
    signals.push({
      id: "test-security",
      label: "tests mention security keywords",
      weight: testBonus,
      hits: 1,
      contribution: round4(testBonus),
      evidence: [],
    });
  }

  signals.sort((a, b) => b.contribution - a.contribution || (a.id < b.id ? -1 : 1));
  const size = diff.linesAdded + diff.linesRemoved;
  const hardeningDelta = raw <= 0 ? 0 : round4(raw / Math.log2(2 + size));
  return {
    raw: round4(raw),
    hardeningDelta,
    linesAdded: diff.linesAdded,
    linesRemoved: diff.linesRemoved,
    signals,
  };
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
