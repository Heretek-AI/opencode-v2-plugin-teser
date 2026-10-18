// runCi exit codes and skips across required and allowed opencode versions.
// These already pass on v1; they prove the fake opencode binary works.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runCi } from "../../src/run.ts";
import { fakeRunCount } from "../helpers/fake-opencode.ts";
import {
	isolateCiEnv,
	makePlugin,
	PLUGIN_JS,
	useFake,
} from "../helpers/run-ci.ts";

isolateCiEnv();

const TWO_VERSIONS =
	'opencode:\n  versions: ["2.0.26", "latest"]\ngate:\n  artifact: run-exit-codes-results\n';

describe("runCi exit codes", () => {
	test("a plugin that loads passes tier 1", async () => {
		const fake = useFake([{}]);
		const cwd = makePlugin({ "index.ts": PLUGIN_JS });
		const outcome = await runCi({ cwd, tiers: ["load"], quiet: true });
		expect(outcome.exitCode).toBe(0);
		expect(fakeRunCount(fake)).toBe(1);
	});

	test("a required-version tier 1 failure exits 1", async () => {
		useFake([{ pluginStatus: "missing" }, {}]);
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/config.yaml": TWO_VERSIONS,
		});
		const outcome = await runCi({ cwd, tiers: ["load"], quiet: true });
		expect(outcome.exitCode).toBe(1);
	});

	test("an allowed-version tier 1 failure exits 0 and is reported", async () => {
		useFake([{}, { pluginStatus: "missing" }]);
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/config.yaml": TWO_VERSIONS,
		});
		const outcome = await runCi({ cwd, tiers: ["load"], quiet: true });
		expect(outcome.exitCode).toBe(0);
		expect(readFileSync(outcome.reportPath, "utf8")).toContain(
			"⚠️ allowed failure",
		);
	});

	test("a failing tier 1 skips that version's scripted scenarios", async () => {
		const fake = useFake([{ pluginStatus: "failed" }]);
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/scenarios/smoke.yaml":
				"id: smoke\nmode: scripted\nprompt: hi\nscript:\n  - text: done\n",
		});
		const outcome = await runCi({ cwd, quiet: true });
		expect(outcome.exitCode).toBe(1);
		const smoke = outcome.resultsFile.results.find((r) => r.id === "smoke");
		expect(smoke?.skipped).toBe("tier 1 failed");
		expect(fakeRunCount(fake)).toBe(1);
	});
});
