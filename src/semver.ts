export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  raw: string;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(raw: string): ParsedVersion | null {
  const m = VERSION_RE.exec(raw.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
    raw,
  };
}

export function isPrerelease(version: string): boolean {
  const p = parseVersion(version);
  if (p) return p.prerelease !== null;
  // Calver-style or odd npm versions: treat a hyphen as prerelease (1.0.0-beta, 2026.10.1-beta.1).
  const core = version.trim();
  const plus = core.indexOf("+");
  const cut = plus === -1 ? core : core.slice(0, plus);
  return cut.includes("-");
}

export function versionLine(version: string): string {
  const p = parseVersion(version);
  if (!p) {
    const bits = version.split(".");
    if (bits.length >= 2 && (bits[0] === "0" || Number(bits[0]) >= 2000)) {
      return `${bits[0]}.${bits[1]}`;
    }
    return bits[0] ?? version;
  }
  // 0.x and calver (YYYY.M.P, major >= 2000) use major.minor as the maintenance line.
  if (p.major === 0 || p.major >= 2000) return `${p.major}.${p.minor}`;
  return String(p.major);
}

export function compareSemver(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa && pb) {
    if (pa.major !== pb.major) return pa.major - pb.major;
    if (pa.minor !== pb.minor) return pa.minor - pb.minor;
    if (pa.patch !== pb.patch) return pa.patch - pb.patch;
    if (pa.prerelease === pb.prerelease) return 0;
    if (pa.prerelease === null) return 1;
    if (pb.prerelease === null) return -1;
    return pa.prerelease < pb.prerelease ? -1 : pa.prerelease > pb.prerelease ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export function matchesLine(version: string, line: string): boolean {
  const spec = line.trim().replace(/\.x$/i, "");
  const p = parseVersion(version);
  const parts = spec.split(".").filter(Boolean);
  if (parts.length === 1) {
    if (p) return String(p.major) === parts[0];
    return version === parts[0] || version.startsWith(`${parts[0]}.`);
  }
  if (parts.length >= 2) {
    if (p) return String(p.major) === parts[0] && String(p.minor) === parts[1];
    return version === `${parts[0]}.${parts[1]}` || version.startsWith(`${parts[0]}.${parts[1]}.`);
  }
  return false;
}

function versionGte(version: string, bound: string): boolean {
  return compareSemver(version, bound) >= 0;
}

function versionLt(version: string, bound: string): boolean {
  return compareSemver(version, bound) < 0;
}

/**
 * Minimal range matcher for --range: 8, 8.x, 0.1, 0.1.x, ^8.17.0, ~8.17.1.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const spec = range.trim();
  if (!spec) return true;
  if (spec.startsWith("^")) {
    const base = parseVersion(spec.slice(1));
    const v = parseVersion(version);
    if (!base || !v) return matchesLine(version, spec.slice(1));
    if (v.prerelease) return false;
    if (base.major === 0) {
      return v.major === 0 && v.minor === base.minor && compareSemver(version, spec.slice(1)) >= 0;
    }
    return v.major === base.major && versionGte(version, spec.slice(1));
  }
  if (spec.startsWith("~")) {
    const base = parseVersion(spec.slice(1));
    const v = parseVersion(version);
    if (!base || !v) return matchesLine(version, spec.slice(1));
    if (v.prerelease) return false;
    return v.major === base.major && v.minor === base.minor && versionGte(version, spec.slice(1));
  }
  const m = spec.match(/^>=\s*(\S+)\s+<\s*(\S+)$/);
  if (m) return versionGte(version, m[1]!) && versionLt(version, m[2]!);
  return matchesLine(version, spec);
}
