export const SILENTFIX_VERSION = "0.1.0";

export type AdvisoryStatus = "advisory-fix" | "silent-fix candidate" | "none";

export interface CliOptions {
  packageName?: string;
  last: number;
  includePrerelease: boolean;
  line?: string;
  range?: string;
  around?: string;
  until?: string;
  cacheDir?: string;
  offline: boolean;
  json: boolean;
  markdown: boolean;
  advisoriesFile?: string;
  noAdvisories: boolean;
  help: boolean;
  version: boolean;
}

export interface DistMeta {
  tarball: string;
  integrity?: string;
  shasum?: string;
}

export interface PackumentVersion {
  version: string;
  dist: DistMeta;
}

export interface Packument {
  name: string;
  versions: Record<string, PackumentVersion>;
  time: Record<string, string>;
  "dist-tags"?: Record<string, string>;
}

export interface SelectedVersion {
  version: string;
  published: string;
  dist: DistMeta;
  line: string;
}

export interface SignalHit {
  id: string;
  label: string;
  weight: number;
  hits: number;
  contribution: number;
  evidence: string[];
}

export interface FileChange {
  path: string;
  kind: "add" | "remove" | "modify";
  linesAdded: number;
  linesRemoved: number;
}

export interface DiffResult {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  files: FileChange[];
  addedSourceLines: string[];
  removedSourceLines: string[];
  addedSourcePaths: string[];
  packageJsonAdded?: string;
  packageJsonRemoved?: string;
  changelogAdded: string[];
}

export interface FormulaCompare {
  rawClamped: number;
  rawSigned: number;
  changedLines: number;
  log2Clamped: number;
  sqrtSigned: number;
  sqrtClamped: number;
}

export interface ScoreResult {
  raw: number;
  rawSigned: number;
  hardeningDelta: number;
  linesAdded: number;
  linesRemoved: number;
  signals: SignalHit[];
  formulaCompare: FormulaCompare;
}

export interface GhsaVulnerability {
  package?: { ecosystem?: string; name?: string };
  vulnerable_version_range?: string | null;
  first_patched_version?: string | { identifier?: string } | null;
}

export interface GhsaAdvisory {
  ghsa_id: string;
  summary?: string;
  vulnerabilities?: GhsaVulnerability[];
}

export interface MatchedAdvisory {
  ghsaId: string;
  firstPatchedVersion: string;
  summary?: string;
}

export interface RankedRelease {
  rank: number;
  version: string;
  published: string;
  fromVersion: string;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  hardeningDelta: number;
  outlierScore: number | null;
  combinedScore: number;
  advisoryStatus: AdvisoryStatus;
  advisories: MatchedAdvisory[];
  signals: SignalHit[];
  topSignals: string[];
  incomplete: boolean;
  skipReasons: string[];
  formulaCompare?: FormulaCompare;
}

export interface AnalysisWindow {
  last: number;
  includePrerelease: boolean;
  line: string | null;
  range: string | null;
  around: string | null;
  until: string | null;
  versionsConsidered: number;
  versionsScored: number;
}

export interface Analysis {
  tool: "silentfix";
  toolVersion: string;
  package: string;
  generatedAt: string;
  cacheDir: string;
  offline: boolean;
  window: AnalysisWindow;
  advisoriesFetched: boolean;
  advisoryWarning?: string;
  incomplete: boolean;
  incompleteReasons: string[];
  lowHistory: boolean;
  releases: RankedRelease[];
}

export interface AnalyzeOptions {
  packageName: string;
  last: number;
  includePrerelease: boolean;
  line?: string;
  range?: string;
  around?: string;
  until?: string;
  cacheDir: string;
  offline: boolean;
  advisoriesFile?: string;
  noAdvisories: boolean;
  now?: string;
  log?: (message: string) => void;
  fetchPackument?: (pkg: string) => Promise<Packument>;
  fetchTarball?: (url: string) => Promise<Buffer>;
  fetchAdvisories?: (pkg: string) => Promise<GhsaAdvisory[]>;
  /** Attach per-release log2 vs sqrt formula numbers (validation / docs). */
  compareFormulas?: boolean;
}
