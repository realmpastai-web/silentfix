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

`files changed` in the table counts every path whose content (or presence) changed, including skipped types, so the number matches a coarse `diff -rq`.

## Hardening Delta

For each rule *k* with weight *w_k*:

\[
\mathrm{hits}^{\mathrm{net}}_k = \max\bigl(0,\; \mathrm{hits}^{\mathrm{added}}_k - \tfrac12\,\mathrm{hits}^{\mathrm{removed}}_k\bigr)
\]

Hits per rule are capped at 8. Evidence strings are the first three matching added lines (trimmed, 160 chars).

\[
\mathrm{raw} = \sum_k w_k \cdot \mathrm{hits}^{\mathrm{net}}_k + B_{\mathrm{tighten}} + B_{\mathrm{deps}} + B_{\mathrm{changelog}} + B_{\mathrm{tests}}
\]

\[
H = \begin{cases}
0 & \mathrm{raw} \le 0 \\
\mathrm{round}_4\bigl(\mathrm{raw} / \log_2(2 + A + R)\bigr) & \text{otherwise}
\end{cases}
\]

*A* and *R* are added and removed **source** lines after a style-normalize step (`let`/`const`/`var` → `var`, `void 0` → `undefined`, trailing commas/semicolons/whitespace collapsed, `"version"` fields ignored). Signal matching still uses the raw lines, so a `MAX_LENGTH` retune is visible; a mass `let` → `const` pass does not inflate the denominator. The log is the size penalty: a 5-line guard outranks a 2 000-line refactor that happens to mention `.length`.

`round_4` is `Math.round(x * 10000) / 10000`.

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

## Combined rank

\[
C_i = H_i \cdot \bigl(1 + \max(0, z_i) / 2\bigr)
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
| `silent-fix candidate` | Not an advisory-fix, **and** \(z \ge 2.0\), **and** \(H \ge 0.8\), **and** at most 50 files changed (bulk republishes are not candidates). |
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

## Known false-positive sources

- **Bulk republishes** (hundreds or thousands of files) saturate regex/proto hit caps and look “hard” until the 50-file candidate cap drops them. Rank can still put a smaller bulk diff first.
- **Cosmetic `let` → `const` plus a `MAX_*` tweak** still has a size penalty; leftover `MAX_*` hits can lift a release.
- **`=== undefined` refactors** fire `undef-guard` on any defensive coding, not only security.
- **Regex-heavy features** (new glob syntax, new path patterns) fire `regex-touch` / `regex-bound`.
- **Test-only churn** that mentions “security” in comments.
- **First release on a line** still falls back to the previous-by-time tarball (often a major bump). Prefer `--line` to keep a single maintenance line.
- **Minified or generated bundles** skipped when named `*.min.js`; other generated JS is scored.
- **Advisories that omit `first_patched_version`** cannot mark `advisory-fix`.
- **Yanked / republished versions** follow npm `time` and may shuffle the window.

If a known patched release does not land in the top 3, the honest fix is a better signal — never a package-name or version special case.
