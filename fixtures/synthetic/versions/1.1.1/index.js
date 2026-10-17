"use strict";

const MAX_LEN = 32000;

module.exports.parse = function parse(str) {
  if (typeof str !== "string" || str.length > MAX_LEN) {
    throw new TypeError("invalid pattern");
  }
  // bound quantifiers to avoid backtracking / ReDoS
  return new RegExp("^" + str.split("*").join(".{0,64}") + ".{0,256}$");
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

module.exports.stringify = function stringify(obj) {
  return JSON.stringify(obj);
};
