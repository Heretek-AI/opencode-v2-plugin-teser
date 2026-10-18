// Review S6 and S7: pull request runs read the base branch's gate history,
// and `run --gate-artifact` (what the Action passes) names the history
// artifact.
import { describe, expect, test } from "bun:test";
import { parseRunArgs } from "../../src/cli.ts";
import { historyBranch } from "../../src/gate/history.ts";

describe("gate wiring", () => {
	test("pull request runs read the base branch; other runs their own ref", () => {
		expect(
			historyBranch({ GITHUB_REF_NAME: "4/merge", GITHUB_BASE_REF: "main" }),
		).toBe("main");
		expect(
			historyBranch({ GITHUB_REF_NAME: "main", GITHUB_BASE_REF: "" }),
		).toBe("main");
		expect(historyBranch({ GITHUB_REF_NAME: "release" })).toBe("release");
		expect(historyBranch({})).toBeUndefined();
	});

	test("--gate-artifact is parsed in both spellings", () => {
		expect(parseRunArgs(["--gate-artifact", "leg-a"]).gateArtifact).toBe(
			"leg-a",
		);
		expect(parseRunArgs(["--gate-artifact=leg-b"]).gateArtifact).toBe("leg-b");
		expect(parseRunArgs([]).gateArtifact).toBeUndefined();
	});
});
