# silentfix method

silentfix is a **heuristic**. A high Hardening Delta means a release’s npm tarball diff *looks like* defensive coding, not that a vulnerability was silently patched. Always read the diff.

Formulas below are exact for v0.1.0. Nothing is keyed on package name or version number.

## Window

1. Fetch the npm packument (`GET https://registry.npmjs.org/<package>`).
2. Drop `time.created` / `time.modified`. Keep versions that exist in both `versions` and `time`.
3. Skip prereleases (a `-` prerelease identifier, including calver like `2026.10.1-beta.1`) unless `--include-prerelease`.
4. Apply `--line` / `--range` / `--until` filters.
5. Sort remaining versions by publish time (tie-break: semver).
6. Take the last **N+1** versions (`--last N`, default 20), or a same-length window centered with `--around`.
7. The oldest row in the window is a baseline. Each newer version is scored against its **same-line predecessor** (previous published version that shares the maintenance line), falling back to the immediate previous-by-time release when the line is new in the catalog.

Maintenance line: `0.x` and calver (`major >= 2000`, e.g. `2026.10.4`) use **major.minor**; other versions use **major**. That way `0.1.10` diffs `0.1.9` even if `8.0.0` was published a few minutes later, and `2026.10.4` diffs `2026.10.3` rather than a same-day `2026.9.33`.

`--line 0.1` keeps `0.1.x`. `--line 8` keeps major 8. Use this when security patches ship on an old maintenance line that is not in the global last-N by time.

## Diff

Unpacked trees are compared as a **bag-of-lines** (order-insensitive counts). Identical lines cancel. That way a moved function nets ~0 and a one-line guard still shows up.

Only these paths contribute to the scored line counts:

- `*.js`, `*.mjs`, `*.cjs`, `*.ts`, `*.mts`, `*.cts`, `*.jsx`, `*.tsx`
- `package.json` (also inspected for dependency bumps)

Skipped: `node_modules`, VCS dirs, symlinks, source maps, minified JS, `.d.ts`, images/fonts/wasm, LICENSE, and source files larger than 1.5 MiB (typical generated bundles). Markdown is skipped except `CHANGELOG.md` / `HISTORY.md`, which can add a small changelog bonus and do **not** inflate the size penalty.

Unpack (JS, not the system `tar` CLI):

- gzip decompress is bounded at **256 MiB** (`gunzipSync(buf, { maxOutputLength })`). Oversize or corrupt gzip is a **per-version skip** (`gzip output exceeded 256 MiB` / `gzip decompress failed`), not a process crash.
- PAX `path=` records (type `x`/`g`) and GNU `L` longnames are applied to the next entry. Ustar `name`/`prefix` alone truncates paths past 100 bytes and can drop `.js`.
- Real tar members are capped at **20 000** (pax `x`/`g` and GNU `L`/`K` metadata headers do not count). Past that, remaining members are not read.
- Type `2` (symlink) and type `1` (hard link) are not extracted. They are counted.

Any skip, cap, or skipped link sets `incomplete: true` and a list of reasons on the JSON report, the Markdown table, and the terminal header.

`files changed` in the table counts every path whose content (or presence) changed, including skipped types, so the number matches a coarse `diff -rq`.

## Hardening Delta

For each rule *k* with weight *w_k*, hits are counted on added and removed source lines (cap 8 per rule). Evidence strings are the first three matching added lines (trimmed, 160 chars).

\[
\mathrm{raw}^{\mathrm{signed}} = \sum_k w_k \cdot \bigl(\mathrm{hits}^{\mathrm{added}}_k - \tfrac12\,\mathrm{hits}^{\mathrm{removed}}_k\bigr) + B_{\mathrm{tighten}} + B_{\mathrm{deps}} + B_{\mathrm{changelog}} + B_{\mathrm{tests}}
\]

\[
\mathrm{raw}^{\mathrm{clamped}} = \sum_k w_k \cdot \max\bigl(0,\; \mathrm{hits}^{\mathrm{added}}_k - \tfrac12\,\mathrm{hits}^{\mathrm{removed}}_k\bigr) + B_{\ldots}
\]

*A* and *R* are added and removed **source** lines after a style-normalize step (`let`/`const`/`var` → `var`, `void 0` → `undefined`, trailing commas/semicolons/whitespace collapsed, `"version"` fields ignored). Signal matching still uses the raw lines. `round_4` is `Math.round(x * 10000) / 10000`.

v0.1 ships the **signed / sqrt** formula (the original spec). It ranked known GHSA patched versions better than clamped / log2 on the validation set below.

\[
H = \mathrm{round}_4\bigl(\mathrm{raw}^{\mathrm{signed}} / \sqrt{1 + A + R}\bigr)
\]

The log2 alternative that was prototyped:

\[
H_{\log_2} = \begin{cases}
0 & \mathrm{raw}^{\mathrm{clamped}} \le 0 \\
\mathrm{round}_4\bigl(\mathrm{raw}^{\mathrm{clamped}} / \log_2(2 + A + R)\bigr) & \text{otherwise}
\end{cases}
\]

sqrt grows faster than log2, so a 418-file republish or a 1 000-line parser rewrite is crushed relative to a 20-line ReDoS guard. Negative *H* means the release *removed* more hardening-shaped text than it added (not “anti-security”; it just should not rank high).

### Weights

| id | weight | Added-line detector (simplified) |
| --- | ---: | --- |
| `regex-bound` | 14 | `{n,m}` quantifiers, `.{0,n}` |
| `backtrack-guard` | 12 | `backtrack`, `redos`, `catastrophic backtracking`, `(?!` |
| `proto-guard` | 12 | `__proto__` |
| `constructor-key` | 8 | `=== 'constructor'` / `["constructor"]` |
| `prototype-key` | 6 | `=== 'prototype'` / `.constructor.prototype` |
| `null-object` | 8 | `Object.create(null)` |
| `has-own` | 5 | `Object.hasOwn`, `hasOwnProperty` |
| `max-limit` | 8 | `MAX_*`, `*_SIZE`/`*_LIMIT`/`*_COUNT`, `maxLength`, `maxHeaders`, `maxFragments`, … |
| `length-check` | 6 | `.length` / `.byteLength` compared |
| `throw-validation` | 6 | `throw new TypeError` / `RangeError` / `SyntaxError` / `Error` |
| `undef-guard` | 5 | `=== undefined`, `== null` |
| `path-normalize` | 8 | `path.normalize` / `path.resolve`, `'..'` checks |
| `escape-sanitize` | 6 | `sanitize`, `encodeURIComponent`, `escapeHtml` |
| `split-limit` | 4 | `split(sep, n)` |
| `depth-guard` | 6 | `maxDepth`, `depth` compared |
| `regex-touch` | 7 | regex literal or `new RegExp` |
| `security-comment` | 4 | CVE/GHSA/DoS/security words |
| `header-validate` | 5 | `headers.upgrade`, `abortHandshake`, invalid header |

Extras (not line-regex rules):

| id | bonus | When |
| --- | ---: | --- |
| `limit-tighten` | 16 | A `MAX_*` / `maxLength` numeric value on added lines is **smaller** than on removed lines (e.g. 65536 → 10000). `1024 * 64` is evaluated as a product. |
| `dep-bump` | ≤ 3 | `dependencies` / `optionalDependencies` / `peerDependencies` version changes (patch 1.5, minor 1, major 0.5). |
| `changelog-security` | 3 × hits (cap 4) | Added changelog lines mentioning security/CVE/GHSA/ReDoS. |
| `test-security` | 4–8 | Added lines mention security keywords (`__proto__`, ReDoS, injection, …). |

## Outlier score

Let \(x_i = H_i\) for the scored window.

\[
\mathrm{med} = \mathrm{median}(x),\quad
\mathrm{MAD} = \mathrm{median}(|x_i - \mathrm{med}|)
\]

\[
z_i = \begin{cases}
0.6745 \cdot (x_i - \mathrm{med}) / \mathrm{MAD} & \mathrm{MAD} \ge 10^{-12} \\
+1,\;0,\;-1 & \mathrm{MAD} \approx 0 \text{ and } x_i >,\;=,\;< \mathrm{med}
\end{cases}
\]

This is the usual robust (modified) z-score. It is computed **within the current window**, so a package that always ships large refactors will not mark every release as an outlier.

**Low-history:** if fewer than **5** pairs were actually scored (window too short, or versions skipped), the run is marked `lowHistory`. Every `outlierScore` is JSON `null` / table `n/a`, combined rank is just *H*, and **silent-fix candidate is never emitted** (advisory-fix still is). Do not trust a z-score on three diffs.

## Combined rank

\[
C_i = \begin{cases}
H_i & z_i \text{ is null (low-history)} \\
H_i \cdot \bigl(1 + \max(0, z_i) / 2\bigr) & \text{otherwise}
\end{cases}
\]

Rank 1 is the highest *C*, then highest *H*, then newest publish time, then semver. Rank is always shown.

## Advisory matching

`GET https://api.github.com/advisories?ecosystem=npm&affects=<package>`

- Unauthenticated is fine (60 req/hour). If `GITHUB_TOKEN` or `GH_TOKEN` is set it is sent as `Authorization: Bearer …` and **never printed**.
- Pagination follows `Link: rel="next"` (capped at 20 pages).
- 403/429 → warning on stderr, continue with whatever was collected (possibly none).

For each advisory vulnerability whose `package.ecosystem` is `npm` and `package.name` matches (case-insensitive), read `first_patched_version` (string or `{ identifier }`).

| status | Rule |
| --- | --- |
| `advisory-fix` | This version **is** a `first_patched_version` (list the GHSA ids). |
| `silent-fix candidate` | Not an advisory-fix, **and** *z* is not null, **and** \(z \ge 2.0\), **and** \(H \ge 0.8\), **and** at most 50 files changed (bulk republishes are not candidates). Low-history runs never emit this. |
| `none` | Otherwise. |

A real patched release that GitHub already knows about is labeled `advisory-fix` even if it is also an outlier. Candidates are the interesting leftovers: high-hardening diffs with no advisory naming that version as the fix.

## Integrity and cache

Tarballs are checked against npm `dist.integrity` (SRI sha512/sha384/sha256/sha1) or `dist.shasum`. Default cache: `~/.cache/silentfix` (`--cache-dir`, `SILENTFIX_CACHE_DIR`). Layout:

```
packuments/<encoded-name>.json
tarballs/<encoded-name>/<version>.tgz
unpacked/<encoded-name>/<version>/
advisories/<encoded-name>.json
```

`--offline` reads only this tree (and `--advisories-file` if given). Tests seed a cache and never touch the network.

## Formula comparison (why sqrt-signed)

Same diffs, three size penalties. Rank of the named GHSA patched version (lower is better). `sqrt-clamped` is shown for completeness; v0.1 uses **sqrt-signed**.

| package / patched version | log2-clamped rank (H) | sqrt-signed rank (H) | sqrt-clamped rank (H) |
| --- | --- | --- | --- |
| path-to-regexp **0.1.10** (`--line 0.1`) | **1** (16.86) | 2 (12.08) | 2 (12.08) |
| ws **8.17.1** (`--line 8`) | 3 (6.34) | 3 (5.66) | 3 (5.66) |
| braces **3.0.3** (`--last 20`) | 3 (7.53) | **2** (6.72) | **2** (6.72) |
| lodash **4.17.23** (`--last 15`) | 2 (22.98) | **1** (15.43) | **1** (15.43) |
| lodash **4.17.12** | 5 (12.81) | **3** (7.97) | **3** (7.97) |
| lodash **4.17.21** | 6 (7.42) | **4** (4.35) | **4** (4.35) |
| lodash **4.17.11** | 8 (4.87) | **6** (3.77) | **6** (3.77) |
| Sum of those ranks | 28 | **21** | **21** |

path-to-regexp 0.1.10 drops from #1 to #2 only because 0.1.13 (also `advisory-fix`, two `backtrack = ''` lines, 2 source lines) gets a slightly larger sqrt *H*. The ReDoS patch is still #2.

lodash **4.17.17** is a 418-file republish: log2 *H* = 30.10 (**rank 1**, saturates the hit caps); sqrt-signed *H* = 3.04 (**rank 9**). That is the size-penalty bug the spec’s sqrt was meant to catch. The 50-file candidate cap already kept it off `silent-fix candidate`; it still stole rank 1 under log2.

braces **2.0.0** (false positive, below): log2 *z* ≥ 2 → `silent-fix candidate` at rank 2; sqrt-signed *z* = 1.24 → `none` at rank 3.

## Known false-positive sources

- **Bulk republishes** (hundreds or thousands of files) saturate regex/proto hit caps. The 50-file candidate cap drops them from `silent-fix candidate`. sqrt rank no longer puts lodash 4.17.17 first.
- **ws 8.20.0** (`--line 8`): 6 files, 49 added / 26 removed. `regex-touch` hits the cap on `require('./lib/permessage-deflate')`-style paths because `/lib/…/` looks like a regex literal, plus `maxPayload` fires `max-limit`. Not an advisory-fix; still a `silent-fix candidate` under both formulas (sqrt *H* = 6.19, *z* = 2.69). Honest leftover: tighten `regex-touch`, do not special-case `ws`.
- **braces 2.0.0** (`--last 20`): 1.8.5 → 2.0.0 is a **major rewrite** (1056 added / 303 removed) that introduces a new parser with `MAX_LENGTH`, `throw new TypeError`, `hasOwnProperty`, and `(?!` backtracking in glob syntax. That is product code, not a silent CVE patch. log2 rewarded the volume (*H* = 16.04, candidate). sqrt drops it below 3.0.3 and below *z* = 2.
- **Cosmetic `let` → `const` plus a `MAX_*` tweak** still has a size penalty; leftover `MAX_*` hits can lift a release.
- **`=== undefined` refactors** fire `undef-guard` on any defensive coding, not only security.
- **Regex-heavy features** (new glob syntax, new path patterns) fire `regex-touch` / `regex-bound`.
- **Test-only churn** that mentions “security” in comments.
- **First release on a line** still falls back to the previous-by-time tarball (often a major bump). Prefer `--line` to keep a single maintenance line.
- **Minified or generated bundles** skipped when named `*.min.js`; other generated JS is scored.
- **Advisories that omit `first_patched_version`** cannot mark `advisory-fix`.
- **Yanked / republished versions** follow npm `time` and may shuffle the window.

### Explicit exclusion: oversized tarballs / openclaw

silentfix is for ordinary npm library tarballs. It is **not** a monorepo-diff tool.

- gzip output **> 256 MiB** → that version is skipped (`incomplete`, reason `gzip output exceeded 256 MiB`). Several `openclaw` 2026.9/2026.10 tarballs decompress to 268–400 MB; they are skipped on purpose.
- Even versions that unpack can show **5k–17k files changed**. Per-rule hit caps saturate on that much text; ranks among those rows are not a security signal. They already cannot be `silent-fix candidate` (> 50 files). Treat openclaw-scale diffs as out of scope.

`silentfix openclaw --last 20` after this bound: 8 versions skipped as gzip-oversize; 11 scored pairs with *H* ≈ 0.30–0.37 on 5k–14k-file diffs; no silent-fix candidates. That is the intended exclusion, not a ranking of security patches.

If a known patched release does not land in the top 3, the honest fix is a better signal — never a package-name or version special case.
