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
  if (analysis.lowHistory) {
    lines.push(
      "**Low-history:** fewer than 5 scored pairs; outlier z is omitted and silent-fix candidates are disabled.",
    );
  }
  if (analysis.incomplete) {
    const why = analysis.incompleteReasons.length ? analysis.incompleteReasons.join("; ") : "unpack incomplete";
    lines.push(`**Incomplete:** ${why}`);
  }
  lines.push("");
  lines.push("| rank | version | date | files | delta | outlier | status | signals |");
  lines.push("| ---: | --- | --- | ---: | ---: | ---: | --- | --- |");
  const ranked = [...analysis.releases].sort((a, b) => a.rank - b.rank);
  for (const r of ranked) {
    const signals = r.topSignals.join(", ") || "—";
    const z = r.outlierScore === null ? "n/a" : r.outlierScore.toFixed(2);
    const ver = r.incomplete ? `\`${r.version}\`*` : `\`${r.version}\``;
    lines.push(
      `| ${r.rank} | ${ver} | ${dateOnly(r.published)} | ${r.filesChanged} | ${r.hardeningDelta.toFixed(2)} | ${z} | ${statusText(r)} | ${signals} |`,
    );
  }
  lines.push("");
  if (ranked.some((r) => r.incomplete)) {
    lines.push("_\\* unpack incomplete (skipped links, entry cap, or gzip bound). See Incomplete above._");
  }
  lines.push(
    "_Hardening Delta is a heuristic over the tarball diff, not proof of a security fix. See [docs/method.md](docs/method.md)._",
  );
  lines.push("");
  return lines.join("\n");
}
