"use strict";

module.exports.parse = function parse(str) {
  return new RegExp("^" + str.split("*").join(".*") + ".*$");
};

module.exports.merge = function merge(target, src) {
  for (const k of Object.keys(src)) {
    target[k] = src[k];
  }
  return target;
};

module.exports.stringify = function stringify(obj) {
  return JSON.stringify(obj);
};
