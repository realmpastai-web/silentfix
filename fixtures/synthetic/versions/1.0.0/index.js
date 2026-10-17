"use strict";

module.exports.parse = function parse(str) {
  return new RegExp("^" + str.split("*").join(".*") + ".*$");
};

module.exports.merge = function merge(a, b) {
  for (const k of Object.keys(b)) {
    a[k] = b[k];
  }
  return a;
};
