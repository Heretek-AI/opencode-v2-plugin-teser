// OCI-6.1-allowed-wiring: `partitionVersions` splits the opencode matrix
// into the required first version and the allowed-to-fail rest, and `runCi`
// feeds the rest to the report renderer. Dropping that wiring (the
// `slice(1)` → `[]` sabotage, which renders allowed legs as required)
// goes red here.
import { describe, expect, test } from "bun:test";
import { partitionVersions } from "../../src/run.ts";

describe("partitionVersions", () => {
	test("first version is required, the rest are allowed", () => {
		expect(partitionVersions(["2.0.26", "latest"])).toEqual({
			required: "2.0.26",
			allowedVersions: ["latest"],
		});
	});

	test("a single version has no allowed versions", () => {
		expect(partitionVersions(["2.0.26"])).toEqual({
			required: "2.0.26",
			allowedVersions: [],
		});
	});

	test("three versions keep order", () => {
		expect(partitionVersions(["2.0.26", "2.0.32", "latest"])).toEqual({
			required: "2.0.26",
			allowedVersions: ["2.0.32", "latest"],
		});
	});
});
