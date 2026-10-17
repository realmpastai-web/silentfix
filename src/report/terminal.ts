import type { Analysis, RankedRelease } from "../types.js";

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const c = {
  reset: useColor ? "\x1b[0m" : "",
  bold: useColor ? "\x1b[1m" : "",
  dim: useColor ? "\x1b[2m" : "",
  red: useColor ? "\x1b[31m" : "",
  yellow: useColor ? "\x1b[33m" : "",
  green: useColor ? "\x1b[32m" : "",
  cyan: useColor ? "\x1b[36m" : "",
};

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

function padR(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

function statusText(r: RankedRelease): string {
  if (r.advisoryStatus === "advisory-fix") {
    const ids = r.advisories.map((a) => a.ghsaId).join(", ");
    return ids ? `advisory-fix (${ids})` : "advisory-fix";
  }
  if (r.advisoryStatus === "silent-fix candidate") return "silent-fix candidate";
  return "—";
}

function statusColor(status: RankedRelease["advisoryStatus"]): string {
  if (status === "advisory-fix") return c.green;
  if (status === "silent-fix candidate") return c.yellow;
  return c.dim;
}

function dateOnly(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 10);
  return new Date(t).toISOString().slice(0, 10);
}

function fmt(n: number, digits = 2): string {
  return n.toFixed(digits);
}

export function formatTerminal(analysis: Analysis): string {
  const lines: string[] = [];
  const filters = [
    analysis.window.line ? `line ${analysis.window.line}` : null,
    analysis.window.range ? `range ${analysis.window.range}` : null,
    analysis.window.around ? `around ${analysis.window.around}` : null,
    analysis.window.until ? `until ${analysis.window.until}` : null,
    analysis.window.includePrerelease ? "prereleases" : null,
    analysis.offline ? "offline" : null,
  ].filter(Boolean);
  lines.push(
    `${c.bold}silentfix${c.reset} ${analysis.toolVersion}  package: ${c.cyan}${analysis.package}${c.reset}  last ${analysis.window.last}  scored ${analysis.window.versionsScored}/${analysis.window.versionsConsidered}`,
  );
  if (filters.length) lines.push(`${c.dim}${filters.join(" · ")}${c.reset}`);
  if (analysis.advisoryWarning) {
    lines.push(`${c.yellow}advisory: ${analysis.advisoryWarning}${c.reset}`);
  }
  if (analysis.lowHistory) {
    lines.push(
      `${c.yellow}low-history: fewer than 5 scored pairs; outlier z omitted, silent-fix candidates disabled${c.reset}`,
    );
  }
  if (analysis.incomplete) {
    const why = analysis.incompleteReasons.length ? analysis.incompleteReasons.join("; ") : "unpack incomplete";
    lines.push(`${c.yellow}incomplete: ${why}${c.reset}`);
  }
  lines.push("");

  const ranked = [...analysis.releases].sort((a, b) => a.rank - b.rank);
  const rows = ranked.map((r) => ({
    rank: String(r.rank),
    version: r.version,
    date: dateOnly(r.published),
    files: String(r.filesChanged),
    delta: fmt(r.hardeningDelta),
    outlier: r.outlierScore === null ? "n/a" : fmt(r.outlierScore),
    status: statusText(r),
    signals: r.topSignals.join(", ") || "—",
    raw: r,
  }));

  const w = {
    rank: Math.max(4, ...rows.map((r) => r.rank.length)),
    version: Math.max(7, ...rows.map((r) => r.version.length)),
    date: 10,
    files: Math.max(5, ...rows.map((r) => r.files.length)),
    delta: Math.max(5, ...rows.map((r) => r.delta.length)),
    outlier: Math.max(7, ...rows.map((r) => r.outlier.length)),
    status: Math.max(6, ...rows.map((r) => r.status.length)),
    signals: Math.max(7, ...rows.map((r) => r.signals.length)),
  };

  const header = [
    pad("rank", w.rank),
    pad("version", w.version),
    pad("date", w.date),
    padR("files", w.files),
    padR("delta", w.delta),
    padR("outlier", w.outlier),
    pad("status", w.status),
    "signals",
  ].join("  ");
  lines.push(`${c.dim}${header}${c.reset}`);
  lines.push(
    `${c.dim}${[
      "-".repeat(w.rank),
      "-".repeat(w.version),
      "-".repeat(w.date),
      "-".repeat(w.files),
      "-".repeat(w.delta),
      "-".repeat(w.outlier),
      "-".repeat(w.status),
      "-".repeat(7),
    ].join("  ")}${c.reset}`,
  );

  for (const row of rows) {
    const sc = statusColor(row.raw.advisoryStatus);
    const rank = row.raw.rank === 1 ? `${c.bold}${padR(row.rank, w.rank)}${c.reset}` : padR(row.rank, w.rank);
    lines.push(
      [
        rank,
        pad(row.version, w.version),
        pad(row.date, w.date),
        padR(row.files, w.files),
        padR(row.delta, w.delta),
        padR(row.outlier, w.outlier),
        `${sc}${pad(row.status, w.status)}${c.reset}`,
        row.signals,
      ].join("  "),
    );
  }

  lines.push("");
  lines.push(
    `${c.dim}Hardening Delta is a heuristic over the tarball diff, not proof of a security fix. See docs/method.md.${c.reset}`,
  );
  return lines.join("\n");
}
