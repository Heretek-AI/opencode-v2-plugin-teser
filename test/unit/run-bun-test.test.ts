// Review B3: the bun-test case runs .opencode-ci/**/*.test.ts and reports
// both outcomes. `bun test .opencode-ci` never matches (bun skips
// dot-directories), so this test fails until each file is passed by path.
import { describe, expect, test } from "bun:test";
import { runCi } from "../../src/run.ts";
import {
	isolateCiEnv,
	makePlugin,
	PLUGIN_JS,
	useFake,
} from "../helpers/run-ci.ts";

isolateCiEnv();

describe("bun-test case", () => {
	test("a passing test file makes bun-test pass", async () => {
		useFake([{}]);
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/ok.test.ts":
				'import { expect, test } from "bun:test";\ntest("fine", () => expect(1).toBe(1));\n',
		});
		const outcome = await runCi({ cwd, tiers: ["scripted"], quiet: true });
		const row = outcome.resultsFile.results.find((r) => r.id === "bun-test");
		expect(row?.pass).toBe(true);
		expect(outcome.exitCode).toBe(0);
	});

	test("a failing test file in a subdir makes bun-test fail with its name", async () => {
		useFake([{}]);
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/nested/bad.test.ts":
				'import { expect, test } from "bun:test";\ntest("deliberately fails", () => expect(1).toBe(2));\n',
		});
		const outcome = await runCi({ cwd, tiers: ["scripted"], quiet: true });
		const row = outcome.resultsFile.results.find((r) => r.id === "bun-test");
		expect(row?.pass).toBe(false);
		expect((row?.failures ?? []).join("\n")).toContain("deliberately fails");
		expect(outcome.exitCode).toBe(1);
	});
});
