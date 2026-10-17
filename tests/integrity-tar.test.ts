import { describe, expect, it } from "vitest";
import { integrityOf, verifyIntegrity } from "../src/integrity.js";
import { packNpmPackage, unpackTarGz } from "../src/tar.js";

describe("tar + integrity", () => {
  it("round-trips an npm-style tarball and verifies sri", () => {
    const tgz = packNpmPackage([
      { name: "package.json", content: '{"name":"x","version":"1.0.0"}\n' },
      { name: "index.js", content: "module.exports = 1;\n" },
    ]);
    const entries = unpackTarGz(tgz);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["index.js", "package.json"]);
    const sri = integrityOf(tgz);
    expect(() => verifyIntegrity(tgz, { tarball: "x", integrity: sri })).not.toThrow();
    expect(() =>
      verifyIntegrity(tgz, { tarball: "x", integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAA==" }),
    ).toThrow(/integrity mismatch/);
  });
});
