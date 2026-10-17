import { compareSemver } from "./semver.js";
import { classifyStatus, loadAdvisories, patchedVersionsForPackage } from "./advisories.js";
import { defaultCacheDir, unpackedPath } from "./cache.js";
import { diffTrees } from "./diff.js";
import { combinedScore, robustZScores } from "./outlier.js";
import { loadPackument, listedVersions, predecessorOf, selectVersionWindow } from "./registry.js";
import { scoreDiff } from "./score.js";
import { ensureTarball, ensureUnpacked } from "./tarball.js";
import type { Analysis, AnalyzeOptions, RankedRelease, SelectedVersion } from "./types.js";
import { SILENTFIX_VERSION } from "./types.js";

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

  await mapPool([...needed.values()], 4, async (v) => {
    const tgz = await ensureTarball(opts.packageName, v.version, v.dist, cacheDir, {
      offline: opts.offline,
      fetchTarball: opts.fetchTarball,
      log,
    });
    ensureUnpacked(opts.packageName, v.version, tgz, cacheDir, log);
    return tgz;
  });

  const scored = pairs.map(({ from, to }) => {
    log(`diff ${from.version} -> ${to.version}`);
    const diff = diffTrees(
      unpackedPath(cacheDir, opts.packageName, from.version),
      unpackedPath(cacheDir, opts.packageName, to.version),
    );
    const score = scoreDiff(diff);
    return {
      version: to.version,
      published: to.published,
      fromVersion: from.version,
      filesChanged: diff.filesChanged,
      linesAdded: score.linesAdded,
      linesRemoved: score.linesRemoved,
      hardeningDelta: score.hardeningDelta,
      signals: score.signals,
    };
  });

  const deltas = scored.map((s) => s.hardeningDelta);
  const zscores = robustZScores(deltas);

  const adv = await loadAdvisories(opts.packageName, cacheDir, {
    offline: opts.offline,
    noAdvisories: opts.noAdvisories,
    advisoriesFile: opts.advisoriesFile,
    fetchAdvisories: opts.fetchAdvisories,
    log,
  });
  const patched = patchedVersionsForPackage(adv.advisories, opts.packageName);

  const releasesUnranked: Omit<RankedRelease, "rank">[] = scored.map((s, i) => {
    const outlierScore = zscores[i]!;
    const combined = combinedScore(s.hardeningDelta, outlierScore);
    const { status, advisories } = classifyStatus(
      s.version,
      patched,
      s.hardeningDelta,
      outlierScore,
      s.filesChanged,
    );
    return {
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
    };
  });

  const sorted = [...releasesUnranked].sort((a, b) => {
    if (b.combinedScore !== a.combinedScore) return b.combinedScore - a.combinedScore;
    if (b.hardeningDelta !== a.hardeningDelta) return b.hardeningDelta - a.hardeningDelta;
    const t = b.published.localeCompare(a.published);
    if (t !== 0) return t;
    return compareSemver(b.version, a.version);
  });

  const releases: RankedRelease[] = sorted.map((r, i) => ({ ...r, rank: i + 1 }));

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
      versionsScored: releases.length,
    },
    advisoriesFetched: adv.fetched,
    advisoryWarning: adv.warning,
    releases,
  };
}
