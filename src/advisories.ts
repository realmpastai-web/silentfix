import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { advisoriesPath } from "./cache.js";
import { githubHeaders, httpGetText } from "./http.js";
import type { AdvisoryStatus, GhsaAdvisory, GhsaVulnerability, MatchedAdvisory } from "./types.js";

const CANDIDATE_Z = 2.0;
const CANDIDATE_H = 0.8;
/** Security patches are almost never multi-hundred-file republishes. */
const CANDIDATE_MAX_FILES = 50;

export function firstPatchedVersion(vuln: GhsaVulnerability): string | null {
  const fp = vuln.first_patched_version;
  if (!fp) return null;
  if (typeof fp === "string") return fp;
  if (typeof fp === "object" && typeof fp.identifier === "string") return fp.identifier;
  return null;
}

export function patchedVersionsForPackage(advisories: GhsaAdvisory[], packageName: string): Map<string, MatchedAdvisory[]> {
  const name = packageName.toLowerCase();
  const map = new Map<string, MatchedAdvisory[]>();
  for (const adv of advisories) {
    for (const vuln of adv.vulnerabilities ?? []) {
      const pkg = vuln.package?.name?.toLowerCase();
      const eco = vuln.package?.ecosystem?.toLowerCase();
      if (eco && eco !== "npm") continue;
      if (pkg && pkg !== name) continue;
      const patched = firstPatchedVersion(vuln);
      if (!patched) continue;
      const rec: MatchedAdvisory = {
        ghsaId: adv.ghsa_id,
        firstPatchedVersion: patched,
        summary: adv.summary,
      };
      const list = map.get(patched) ?? [];
      if (!list.some((x) => x.ghsaId === rec.ghsaId)) list.push(rec);
      map.set(patched, list);
    }
  }
  return map;
}

export function classifyStatus(
  version: string,
  patched: Map<string, MatchedAdvisory[]>,
  hardeningDelta: number,
  outlierScore: number,
  filesChanged = 0,
): { status: AdvisoryStatus; advisories: MatchedAdvisory[] } {
  const advisories = patched.get(version) ?? [];
  if (advisories.length > 0) return { status: "advisory-fix", advisories };
  if (
    outlierScore >= CANDIDATE_Z &&
    hardeningDelta >= CANDIDATE_H &&
    filesChanged > 0 &&
    filesChanged <= CANDIDATE_MAX_FILES
  ) {
    return { status: "silent-fix candidate", advisories: [] };
  }
  return { status: "none", advisories: [] };
}

function nextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (m) return m[1]!;
  }
  return null;
}

export async function fetchGithubAdvisories(
  packageName: string,
  opts: { log?: (m: string) => void } = {},
): Promise<{ advisories: GhsaAdvisory[]; warning?: string }> {
  const advisories: GhsaAdvisory[] = [];
  let url: string | null =
    `https://api.github.com/advisories?ecosystem=npm&affects=${encodeURIComponent(packageName)}&per_page=100`;
  let pages = 0;
  while (url) {
    pages += 1;
    if (pages > 20) {
      return { advisories, warning: "advisory pagination truncated after 20 pages" };
    }
    opts.log?.(`fetch advisories ${packageName} page ${pages}`);
    let res;
    try {
      res = await httpGetText(url, githubHeaders());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { advisories, warning: `advisory lookup failed: ${msg}` };
    }
    if (res.status === 403 || res.status === 429) {
      return {
        advisories,
        warning: "advisory lookup skipped: GitHub API rate limited (set GITHUB_TOKEN for a higher limit)",
      };
    }
    if (res.status >= 400) {
      return { advisories, warning: `advisory lookup failed: GitHub API ${res.status}` };
    }
    let batch: unknown;
    try {
      batch = JSON.parse(res.text);
    } catch {
      return { advisories, warning: "advisory lookup failed: invalid JSON" };
    }
    if (!Array.isArray(batch)) {
      return { advisories, warning: "advisory lookup failed: unexpected payload" };
    }
    for (const item of batch) {
      if (item && typeof item === "object" && "ghsa_id" in item) {
        advisories.push(item as GhsaAdvisory);
      }
    }
    url = nextLink(res.headers.get("link"));
  }
  return { advisories };
}

export async function loadAdvisories(
  packageName: string,
  cacheDir: string,
  opts: {
    offline: boolean;
    noAdvisories: boolean;
    advisoriesFile?: string;
    fetchAdvisories?: (pkg: string) => Promise<GhsaAdvisory[]>;
    log?: (m: string) => void;
  },
): Promise<{ advisories: GhsaAdvisory[]; fetched: boolean; warning?: string }> {
  if (opts.noAdvisories) return { advisories: [], fetched: false };
  if (opts.advisoriesFile) {
    const text = readFileSync(opts.advisoriesFile, "utf8");
    const parsed = JSON.parse(text) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : ((parsed as { advisories?: GhsaAdvisory[] }).advisories ?? []);
    return { advisories: list as GhsaAdvisory[], fetched: false };
  }
  const path = advisoriesPath(cacheDir, packageName);
  if (opts.offline) {
    if (!existsSync(path)) {
      return { advisories: [], fetched: false, warning: "offline: no cached advisories; status column is none" };
    }
    opts.log?.(`cache hit advisories ${packageName}`);
    return { advisories: JSON.parse(readFileSync(path, "utf8")) as GhsaAdvisory[], fetched: false };
  }
  if (opts.fetchAdvisories) {
    const advisories = await opts.fetchAdvisories(packageName);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(advisories, null, 2));
    return { advisories, fetched: true };
  }
  const { advisories, warning } = await fetchGithubAdvisories(packageName, { log: opts.log });
  if (!warning || advisories.length > 0) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(advisories, null, 2));
  }
  return { advisories, fetched: !warning, warning };
}
