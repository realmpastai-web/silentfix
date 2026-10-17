#!/usr/bin/env node
import { homedir } from "node:os";
import { resolve } from "node:path";
import { analyze } from "./analyze.js";
import { defaultCacheDir } from "./cache.js";
import { helpText, parseArgs } from "./parse-args.js";
import { formatJson } from "./report/json.js";
import { formatMarkdown } from "./report/markdown.js";
import { formatTerminal } from "./report/terminal.js";
import { SILENTFIX_VERSION } from "./types.js";

function resolveCacheDir(raw: string | undefined): string {
  const dir = raw ?? defaultCacheDir();
  if (dir.startsWith("~/")) return resolve(homedir(), dir.slice(2));
  return resolve(dir);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`silentfix: ${msg}\n`);
    return 1;
  }
  if (opts.help) {
    process.stdout.write(helpText());
    return 0;
  }
  if (opts.version) {
    process.stdout.write(`${SILENTFIX_VERSION}\n`);
    return 0;
  }
  if (!opts.packageName) {
    process.stderr.write("silentfix: missing package name\n");
    process.stderr.write(helpText());
    return 1;
  }

  const log = (m: string): void => {
    process.stderr.write(`${m}\n`);
  };

  try {
    const analysis = await analyze({
      packageName: opts.packageName,
      last: opts.last,
      includePrerelease: opts.includePrerelease,
      line: opts.line,
      range: opts.range,
      around: opts.around,
      until: opts.until,
      cacheDir: resolveCacheDir(opts.cacheDir),
      offline: opts.offline,
      advisoriesFile: opts.advisoriesFile,
      noAdvisories: opts.noAdvisories,
      log,
    });
    if (opts.json) process.stdout.write(formatJson(analysis));
    else if (opts.markdown) process.stdout.write(formatMarkdown(analysis));
    else process.stdout.write(`${formatTerminal(analysis)}\n`);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`silentfix: ${msg}\n`);
    return 1;
  }
}

const entry = process.argv[1]?.replace(/\\/g, "/");
if (entry?.endsWith("/cli.js") || entry?.endsWith("/cli.ts")) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`silentfix: ${msg}\n`);
      process.exitCode = 1;
    },
  );
}
