import { compareSemver } from "./semver.js";
import { classifyStatus, loadAdvisories, patchedVersionsForPackage } from "./advisories.js";
import { defaultCacheDir, unpackedPath } from "./cache.js";
import { diffTrees } from "./diff.js";
import { combinedScore, robustZScores } from "./outlier.js";
import { loadPackument, listedVersions, predecessorOf, selectVersionWindow } from "./registry.js";
import { scoreDiff } from "./score.js";
import { ensureTarball, ensureUnpacked, type UnpackMeta } from "./tarball.js";
import type { Analysis, AnalyzeOptions, RankedRelease, SelectedVersion } from "./types.js";
import { SILENTFIX_VERSION } from "./types.js";

/** Robust z and silent-fix candidates require this many successfully scored pairs. */
export const LOW_HISTORY_MIN_PAIRS = 5;

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker(): Promise<void> {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx]!);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

interface VersionUnpack {
  dest?: string;
  meta?: UnpackMeta;
  skipReasons?: string[];
}

interface ScoredPair {
  version: string;
  published: string;
  fromVersion: string;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  hardeningDelta: number;
  signals: RankedRelease["signals"];
  incomplete: boolean;
  skipReasons: string[];
  skipped: boolean;
  formulaCompare?: RankedRelease["formulaCompare"];
}

function prefixReasons(version: string, reasons: string[]): string[] {
  return reasons.map((r) => (r.startsWith(`${version}:`) ? r : `${version}: ${r}`));
}

export async function analyze(opts: AnalyzeOptions): Promise<Analysis> {
  const cacheDir = opts.cacheDir || defaultCacheDir();
  const log = opts.log ?? (() => {});
  const packument = await loadPackument(opts.packageName, cacheDir, {
    offline: opts.offline,
    fetchPackument: opts.fetchPackument,
    log,
  });
  const listed = listedVersions(packument, {
    last: opts.last,
    includePrerelease: opts.includePrerelease,
    line: opts.line,
    range: opts.range,
    around: opts.around,
    until: opts.until,
  });
  const window = selectVersionWindow(listed, {
    last: opts.last,
    includePrerelease: opts.includePrerelease,
    line: opts.line,
    range: opts.range,
    around: opts.around,
    until: opts.until,
  });
  if (window.length < 2) {
    throw new Error(
      `need at least 2 versions to diff (got ${window.length} after filters). Try --include-prerelease, --line, or a larger --last.`,
    );
  }

  const pairs: { from: SelectedVersion; to: SelectedVersion }[] = [];
  for (let i = 1; i < window.length; i += 1) {
    const to = window[i]!;
    const from = predecessorOf(listed, to.version) ?? window[i - 1]!;
    pairs.push({ from, to });
  }

  const needed = new Map<string, SelectedVersion>();
  for (const p of pairs) {
    needed.set(p.from.version, p.from);
    needed.set(p.to.version, p.to);
  }

  const unpacks = new Map<string, VersionUnpack>();
  await mapPool([...needed.values()], 4, async (v) => {
    const tgz = await ensureTarball(opts.packageName, v.version, v.dist, cacheDir, {
      offline: opts.offline,
      fetchTarball: opts.fetchTarball,
      log,
    });
    try {
      const { dest, meta } = ensureUnpacked(opts.packageName, v.version, tgz, cacheDir, log);
      unpacks.set(v.version, { dest, meta });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      unpacks.set(v.version, { skipReasons: [msg] });
    }
    return tgz;
  });

  const analysisReasons: string[] = [];
  for (const [ver, u] of unpacks) {
    if (u.skipReasons?.length) analysisReasons.push(...prefixReasons(ver, u.skipReasons));
    else if (u.meta?.incomplete) analysisReasons.push(...prefixReasons(ver, u.meta.reasons));
  }

  const scored: ScoredPair[] = pairs.map(({ from, to }) => {
    const fromU = unpacks.get(from.version) ?? {};
    const toU = unpacks.get(to.version) ?? {};
    const skipReasons = [
      ...(fromU.skipReasons ? prefixReasons(from.version, fromU.skipReasons) : []),
      ...(toU.skipReasons ? prefixReasons(to.version, toU.skipReasons) : []),
    ];
    if (!fromU.dest || !toU.dest) {
      log(`skip ${from.version} -> ${to.version}`);
      return {
        version: to.version,
        published: to.published,
        fromVersion: from.version,
        filesChanged: 0,
        linesAdded: 0,
        linesRemoved: 0,
        hardeningDelta: 0,
        signals: [],
        incomplete: true,
        skipReasons,
        skipped: true,
      };
    }
    log(`diff ${from.version} -> ${to.version}`);
    const diff = diffTrees(
      fromU.dest || unpackedPath(cacheDir, opts.packageName, from.version),
      toU.dest || unpackedPath(cacheDir, opts.packageName, to.version),
    );
    const score = scoreDiff(diff);
    const reasons = [...(fromU.meta?.reasons ?? []), ...(toU.meta?.reasons ?? [])];
    const incomplete = Boolean(fromU.meta?.incomplete || toU.meta?.incomplete);
    return {
      version: to.version,
      published: to.published,
      fromVersion: from.version,
      filesChanged: diff.filesChanged,
      linesAdded: score.linesAdded,
      linesRemoved: score.linesRemoved,
      hardeningDelta: score.hardeningDelta,
      signals: score.signals,
      incomplete,
      skipReasons: reasons,
      skipped: false,
      formulaCompare: score.formulaCompare,
    };
  });

  const usable = scored.filter((s) => !s.skipped);
  const lowHistory = usable.length < LOW_HISTORY_MIN_PAIRS;
  const zscores = lowHistory ? [] : robustZScores(usable.map((s) => s.hardeningDelta));
  const zByIndex = new Map<number, number | null>();
  if (lowHistory) {
    for (let i = 0; i < scored.length; i += 1) zByIndex.set(i, null);
  } else {
    let ui = 0;
    for (let i = 0; i < scored.length; i += 1) {
      zByIndex.set(i, scored[i]!.skipped ? null : zscores[ui++]!);
    }
  }

  const adv = await loadAdvisories(opts.packageName, cacheDir, {
    offline: opts.offline,
    noAdvisories: opts.noAdvisories,
    advisoriesFile: opts.advisoriesFile,
    fetchAdvisories: opts.fetchAdvisories,
    log,
  });
  const patched = patchedVersionsForPackage(adv.advisories, opts.packageName);

  const releasesUnranked: Omit<RankedRelease, "rank">[] = scored.map((s, i) => {
    const outlierScore = zByIndex.get(i) ?? null;
    const combined = s.skipped ? 0 : combinedScore(s.hardeningDelta, outlierScore);
    const { status, advisories } = classifyStatus(
      s.version,
      patched,
      s.hardeningDelta,
      outlierScore,
      s.filesChanged,
    );
    const row: Omit<RankedRelease, "rank"> = {
      version: s.version,
      published: s.published,
      fromVersion: s.fromVersion,
      filesChanged: s.filesChanged,
      linesAdded: s.linesAdded,
      linesRemoved: s.linesRemoved,
      hardeningDelta: s.hardeningDelta,
      outlierScore,
      combinedScore: combined,
      advisoryStatus: status,
      advisories,
      signals: s.signals,
      topSignals: s.signals.slice(0, 3).map((x) => x.id),
      incomplete: s.incomplete,
      skipReasons: s.skipReasons,
    };
    if (opts.compareFormulas && s.formulaCompare) row.formulaCompare = s.formulaCompare;
    return row;
  });

  const sorted = [...releasesUnranked].sort((a, b) => {
    if (b.combinedScore !== a.combinedScore) return b.combinedScore - a.combinedScore;
    if (b.hardeningDelta !== a.hardeningDelta) return b.hardeningDelta - a.hardeningDelta;
    const t = b.published.localeCompare(a.published);
    if (t !== 0) return t;
    return compareSemver(b.version, a.version);
  });

  const releases: RankedRelease[] = sorted.map((r, i) => ({ ...r, rank: i + 1 }));
  const incompleteReasons = [...new Set(analysisReasons)];

  return {
    tool: "silentfix",
    toolVersion: SILENTFIX_VERSION,
    package: opts.packageName,
    generatedAt: opts.now ?? new Date().toISOString(),
    cacheDir,
    offline: opts.offline,
    window: {
      last: opts.last,
      includePrerelease: opts.includePrerelease,
      line: opts.line ?? null,
      range: opts.range ?? null,
      around: opts.around ?? null,
      until: opts.until ?? null,
      versionsConsidered: listed.length,
      versionsScored: usable.length,
    },
    advisoriesFetched: adv.fetched,
    advisoryWarning: adv.warning,
    incomplete: incompleteReasons.length > 0 || scored.some((s) => s.incomplete),
    incompleteReasons,
    lowHistory,
    releases,
  };
}
