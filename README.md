# silentfix

**Diff consecutive npm releases. Score a Hardening Delta. Flag silent-fix candidates.**

Public MIT-licensed TypeScript CLI. It downloads published tarballs, diffs each release against the previous one in the window, scores how much the diff looks like security hardening, marks outliers against the package’s own history, and cross-checks the [GitHub Advisory Database](https://github.com/advisories).

This is a **heuristic, not proof**. A high score means “this tarball diff looks like validation, bounds, ReDoS, or prototype-pollution guards.” It does **not** mean a CVE was silently patched, and a low score does not mean the release is safe.

## Install

Node 20+. From this repo:

```bash
npm ci
npm run build
node dist/cli.js --help
```

The bin name is `silentfix` → `dist/cli.js`.

## Usage

```bash
silentfix <package> [--last N]
```

`--last` defaults to **20** (21 tarballs, 20 diffs), ordered by npm publish time. Prereleases are skipped unless `--include-prerelease`.

```bash
silentfix ws --last 20
silentfix braces --last 20
silentfix path-to-regexp --line 0.1 --last 20
silentfix ws --line 8 --last 20
silentfix ws --around 8.17.1 --last 20
silentfix lodash --last 15 --json
silentfix openclaw --last 20 --markdown
```

| Option | Meaning |
| --- | --- |
| `--last N` | Number of diffs (default 20) |
| `--include-prerelease` | Keep `1.2.3-beta`, `2026.10.1-beta.1`, … |
| `--line <maj[.min]>` | Only that version line (`8`, `0.1`) |
| `--range <spec>` | `8.x`, `0.1.x`, `^8.17.0`, `~8.17.1` |
| `--around <version>` | Center the window on a version |
| `--until <version>` | Last N published at or before this version |
| `--cache-dir <dir>` | Default `~/.cache/silentfix` |
| `--offline` | Cache/fixtures only; no network |
| `--json` / `--markdown` | Machine / shareable output (stdout) |
| `--advisories-file <path>` | Local GHSA JSON (tests) |
| `--no-advisories` | Skip advisory lookup |

Progress goes to **stderr**. Tables/JSON/Markdown go to **stdout**. If `GITHUB_TOKEN` is set it is used for the Advisory API and never printed.

## Sample output

```
silentfix 0.1.0  package: synthfix  last 5  scored 5/6

 rank  version  date        files  delta  outlier  status                 signals
 ----  -------  ----------  -----  -----  -------  ------                 -------
    1  1.1.1    2020-04-01      3   9.41     4.12  silent-fix candidate   proto-guard, regex-bound, backtrack-guard
    2  1.2.0    2020-05-01      1   0.20     0.10  —                      length-check
    3  1.0.1    2020-02-01      1   0.00     0.00  —                      —
    …
```

Exact numbers depend on the fixture; see `docs/method.md`.

## What it measures

**Hardening Delta** weights added source lines that look like:

- input validation, length / max / limit constants, tightened numeric caps
- regex changes, bounded quantifiers, backtracking / ReDoS guards
- prototype-pollution guards (`__proto__`, `constructor`, `Object.create(null)`, `hasOwn`)
- path normalization / `..` checks, escaping
- `throw new TypeError` / `RangeError` on bad input
- tests or changelog lines that mention security keywords
- small dependency patch bumps

The score is **signed signal delta / sqrt(1 + changed source lines)** so a giant refactor does not win (this beat `raw / log2(2 + changed)` on known GHSA ranks; both columns are in [docs/method.md](docs/method.md)). **Outlier score** is a robust z-score (median / MAD) of Hardening Delta inside the window. With fewer than 5 scored pairs the run is **low-history**: z is omitted and silent-fix candidates are disabled. Releases are ranked by a combined score.

**advisory-fix** — this version is a GitHub Advisory `first_patched_version`.
**silent-fix candidate** — high outlier, no advisory naming it as the patched version.
**none** — everything else.

Full formulas: [docs/method.md](docs/method.md).

## Limitations

- npm tarball ≠ git history. Generated files, vendored assets, and publish-time bundling all show up.
- Each scored release diffs its previous tarball on the same maintenance line (`0.x` / calver: major.minor; otherwise major). A brand-new line still falls back to the previous-by-time release (often a major bump). Use `--line` to stay on one line.
- GitHub may omit `first_patched_version`, rate-limit unauthenticated clients, or list duplicate advisories.
- False positives: undefined-guards, regex features, `require('./lib/foo')` paths that look like regex literals, and `MAX_*` retunes that are not security work. False negatives: logic-only fixes with no matching surface syntax.
- Tarballs that gzip-decompress above 256 MiB, or that contain more than 20 000 tar entries, are skipped or marked incomplete (see `docs/method.md`). That is the explicit exclusion for monorepo-sized packages such as openclaw.
- Does not execute packages, does not prove exploitability, does not replace `npm audit` or a human review.

## License

MIT
