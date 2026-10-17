import type { Analysis, RankedRelease } from "../types.js";

function dateOnly(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 10);
  return new Date(t).toISOString().slice(0, 10);
}

function statusText(r: RankedRelease): string {
  if (r.advisoryStatus === "advisory-fix") {
    const ids = r.advisories.map((a) => a.ghsaId).join(", ");
    return ids ? `advisory-fix (${ids})` : "advisory-fix";
  }
  if (r.advisoryStatus === "silent-fix candidate") return "silent-fix candidate";
  return "—";
}

export function formatMarkdown(analysis: Analysis): string {
  const lines: string[] = [];
  lines.push(`# silentfix ${analysis.toolVersion}: \`${analysis.package}\``);
  lines.push("");
  lines.push(
    `Window: last ${analysis.window.last} · scored ${analysis.window.versionsScored} of ${analysis.window.versionsConsidered} considered versions.`,
  );
  const extras = [
    analysis.window.line ? `line \`${analysis.window.line}\`` : null,
    analysis.window.range ? `range \`${analysis.window.range}\`` : null,
    analysis.window.around ? `around \`${analysis.window.around}\`` : null,
    analysis.window.until ? `until \`${analysis.window.until}\`` : null,
    analysis.offline ? "offline" : null,
  ].filter(Boolean);
  if (extras.length) lines.push(`Filters: ${extras.join(" · ")}`);
  if (analysis.advisoryWarning) lines.push(`**Advisory warning:** ${analysis.advisoryWarning}`);
  lines.push("");
  lines.push("| rank | version | date | files | delta | outlier | status | signals |");
  lines.push("| ---: | --- | --- | ---: | ---: | ---: | --- | --- |");
  const ranked = [...analysis.releases].sort((a, b) => a.rank - b.rank);
  for (const r of ranked) {
    const signals = r.topSignals.join(", ") || "—";
    lines.push(
      `| ${r.rank} | \`${r.version}\` | ${dateOnly(r.published)} | ${r.filesChanged} | ${r.hardeningDelta.toFixed(2)} | ${r.outlierScore.toFixed(2)} | ${statusText(r)} | ${signals} |`,
    );
  }
  lines.push("");
  lines.push(
    "_Hardening Delta is a heuristic over the tarball diff, not proof of a security fix. See [docs/method.md](docs/method.md)._",
  );
  lines.push("");
  return lines.join("\n");
}
