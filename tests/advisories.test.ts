import { describe, expect, it } from "vitest";
import { classifyStatus, patchedVersionsForPackage } from "../src/advisories.js";
import type { GhsaAdvisory } from "../src/types.js";

const sample: GhsaAdvisory[] = [
  {
    ghsa_id: "GHSA-aaaa-bbbb-cccc",
    summary: "demo",
    vulnerabilities: [
      {
        package: { ecosystem: "npm", name: "synthfix" },
        first_patched_version: "1.1.1",
      },
      {
        package: { ecosystem: "npm", name: "other" },
        first_patched_version: "9.9.9",
      },
    ],
  },
  {
    ghsa_id: "GHSA-obj-form",
    vulnerabilities: [
      {
        package: { ecosystem: "npm", name: "synthfix" },
        first_patched_version: { identifier: "1.2.0" },
      },
    ],
  },
];

describe("advisory matching", () => {
  it("maps first_patched_version strings and identifier objects", () => {
    const map = patchedVersionsForPackage(sample, "synthfix");
    expect(map.get("1.1.1")?.map((a) => a.ghsaId)).toEqual(["GHSA-aaaa-bbbb-cccc"]);
    expect(map.get("1.2.0")?.map((a) => a.ghsaId)).toEqual(["GHSA-obj-form"]);
    expect(map.has("9.9.9")).toBe(false);
  });

  it("labels advisory-fix vs silent-fix candidate vs none", () => {
    const map = patchedVersionsForPackage(sample, "synthfix");
    expect(classifyStatus("1.1.1", map, 0, 0, 3).status).toBe("advisory-fix");
    expect(classifyStatus("1.0.1", map, 5, 3, 3).status).toBe("silent-fix candidate");
    expect(classifyStatus("1.0.1", map, 0.1, 0.2, 3).status).toBe("none");
    expect(classifyStatus("1.0.1", map, 5, 3, 400).status).toBe("none");
    expect(classifyStatus("1.0.1", map, 5, null, 3).status).toBe("none");
  });
});
