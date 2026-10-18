// Review S1: one live budget for the whole run, shared by every version.
import { describe, expect, test } from "bun:test";
import { runCi } from "../../src/run.ts";
import { type FakeRun, fakeRunCount } from "../helpers/fake-opencode.ts";
import {
	isolateCiEnv,
	makePlugin,
	PLUGIN_JS,
	useFake,
} from "../helpers/run-ci.ts";

isolateCiEnv();

describe("live budget", () => {
	test("one live budget is shared across opencode versions", async () => {
		const pass: FakeRun = {
			cost: 0.6,
			toolCalls: [{ tool: "echo_tool", result: { content: "echo:hi" } }],
		};
		const fake = useFake([pass]);
		process.env.OPENCODE_API_KEY = "fake";
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/config.yaml":
				'opencode:\n  versions: ["2.0.26", "latest"]\nlive:\n  model: fake/model\n  budgetUSD: 1\n',
			".opencode-ci/scenarios/live.yaml":
				"id: live-smoke\nmode: live\nprompt: hi\nexpect:\n  tools:\n    - name: echo_tool\n",
		});
		const outcome = await runCi({ cwd, tiers: ["live"], quiet: true });
		const rows = outcome.resultsFile.results;
		expect(rows.find((r) => r.opencode === "2.0.26")?.pass).toBe(true);
		expect(rows.find((r) => r.opencode === "latest")?.skipped).toBe(
			"budget exhausted ($1.20 of $1.00)",
		);
		expect(fakeRunCount(fake)).toBe(2);
		expect(outcome.exitCode).toBe(0);
	});
});
