import type { CliOptions } from "./types.js";

const HELP = `silentfix 0.1.0
Diff consecutive npm releases, score a Hardening Delta, and flag silent-fix candidates.

Usage:
  silentfix <package> [--last N] [options]

Options:
  --last N                 Number of consecutive diffs to score (default: 20).
                           Fetches N+1 published versions by npm publish time.
  --include-prerelease     Include prerelease versions (skipped by default).
  --line <maj[.min]>       Restrict to a version line, e.g. 8 or 0.1.
  --range <spec>           Restrict versions (0.1.x, 8.x, ^8.17.0, ~8.17.1).
  --around <version>       Center the window on a version (still length --last).
  --until <version>        Window of versions published at or before this one.
  --cache-dir <dir>        Cache directory (default: ~/.cache/silentfix).
  --offline                Use cache/fixtures only; never hit the network.
  --json                   Print JSON on stdout.
  --markdown               Print a Markdown table on stdout.
  --advisories-file <path> Use a local GitHub Advisory JSON list (tests/fixtures).
  --no-advisories          Skip advisory lookup.
  -h, --help               Show this help.
  -V, --version            Show version.

Heuristic, not proof. A high score means the diff looks like hardening, not that
a CVE was silently patched. See docs/method.md for formulas.
`;

export function helpText(): string {
  return HELP;
}

function takeValue(argv: string[], i: number, flag: string): { value: string; next: number } {
  const cur = argv[i]!;
  const eq = `${flag}=`;
  if (cur.startsWith(eq)) return { value: cur.slice(eq.length), next: i };
  const value = argv[i + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return { value, next: i + 1 };
}

function parseLast(raw: string): number {
  if (!/^[0-9]+$/.test(raw)) throw new Error(`--last must be a positive integer, got ${raw}`);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--last must be a positive integer, got ${raw}`);
  return n;
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    last: 20,
    includePrerelease: false,
    offline: false,
    json: false,
    markdown: false,
    noAdvisories: false,
    help: false,
    version: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-V" || a === "--version") opts.version = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--markdown") opts.markdown = true;
    else if (a === "--offline") opts.offline = true;
    else if (a === "--include-prerelease") opts.includePrerelease = true;
    else if (a === "--no-advisories") opts.noAdvisories = true;
    else if (a === "--last" || a.startsWith("--last=")) {
      const { value, next } = takeValue(argv, i, "--last");
      opts.last = parseLast(value);
      i = next;
    } else if (a === "--line" || a.startsWith("--line=")) {
      const { value, next } = takeValue(argv, i, "--line");
      opts.line = value;
      i = next;
    } else if (a === "--range" || a.startsWith("--range=")) {
      const { value, next } = takeValue(argv, i, "--range");
      opts.range = value;
      i = next;
    } else if (a === "--around" || a.startsWith("--around=")) {
      const { value, next } = takeValue(argv, i, "--around");
      opts.around = value;
      i = next;
    } else if (a === "--until" || a.startsWith("--until=")) {
      const { value, next } = takeValue(argv, i, "--until");
      opts.until = value;
      i = next;
    } else if (a === "--cache-dir" || a.startsWith("--cache-dir=")) {
      const { value, next } = takeValue(argv, i, "--cache-dir");
      opts.cacheDir = value;
      i = next;
    } else if (a === "--advisories-file" || a.startsWith("--advisories-file=")) {
      const { value, next } = takeValue(argv, i, "--advisories-file");
      opts.advisoriesFile = value;
      i = next;
    } else if (!a.startsWith("-")) rest.push(a);
    else throw new Error(`unknown option: ${a}`);
  }
  if (rest.length > 1) throw new Error(`unexpected arguments: ${rest.slice(1).join(" ")}`);
  opts.packageName = rest[0];
  return opts;
}
