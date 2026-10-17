"use strict";

const { merge } = require("./index.js");

module.exports["rejects prototype pollution"] = function () {
  const o = merge({}, JSON.parse('{"__proto__": {"polluted": true}}'));
  return o.polluted === undefined;
};
