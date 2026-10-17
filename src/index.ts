export { analyze } from "./analyze.js";
export { parseArgs, helpText } from "./parse-args.js";
export { scoreDiff, HARDENING_RULES, HARDENING_FORMULA } from "./score.js";
export { robustZScores, combinedScore, median, mad } from "./outlier.js";
export { classifyStatus, patchedVersionsForPackage } from "./advisories.js";
export { diffTrees, bagDiff } from "./diff.js";
export { formatTerminal } from "./report/terminal.js";
export { formatJson } from "./report/json.js";
export { formatMarkdown } from "./report/markdown.js";
export { SILENTFIX_VERSION } from "./types.js";
export type {
  Analysis,
  AnalyzeOptions,
  CliOptions,
  RankedRelease,
  SignalHit,
  AdvisoryStatus,
} from "./types.js";
export { unpackTarGz, unpackTar, TAR_ENTRY_CAP, MAX_GUNZIP_BYTES } from "./tar.js";
