"use strict";

const MAX_LEN = 32000;

module.exports.parse = function parse(input) {
  if (typeof input !== "string" || input.length > MAX_LEN) {
    throw new TypeError("invalid pattern");
  }
  // bound quantifiers to avoid backtracking / ReDoS
  return new RegExp("^" + input.split("*").join(".{0,64}") + ".{0,256}$");
};

module.exports.merge = function merge(target, src) {
  const out = Object.create(null);
  for (const k of Object.keys(target)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    out[k] = target[k];
  }
  for (const k of Object.keys(src)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    if (!Object.hasOwn(src, k)) continue;
    out[k] = src[k];
  }
  return out;
};

module.exports.stringify = function stringify(value) {
  return JSON.stringify(value);
};

module.exports.formatTable = function formatTable(rows) {
  const widths = [];
  for (const row of rows) {
    for (let i = 0; i < row.length; i += 1) {
      const n = String(row[i]).length;
      if (!widths[i] || n > widths[i]) widths[i] = n;
    }
  }
  const lines = [];
  for (const row of rows) {
    const cells = [];
    for (let i = 0; i < row.length; i += 1) {
      const s = String(row[i]);
      cells.push(s + " ".repeat((widths[i] || 0) - s.length));
    }
    lines.push(cells.join(" | "));
  }
  return lines.join("\n");
};

module.exports.pad = function pad(s, n) {
  s = String(s);
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
};

module.exports.repeat = function repeat(s, n) {
  let out = "";
  for (let i = 0; i < n; i += 1) out += s;
  return out;
};
