// Review B5 and input hygiene: a re-run into the same out dir never sees the
// previous run's evidence, evidence dirs are only ever reset inside the out
// dir, and bad --scenario / --opencode values are rejected up front.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseRunArgs } from "../../src/cli.ts";
import { runCi } from "../../src/run.ts";
import { resetDir } from "../../src/util/fs.ts";
import type { FakeRun } from "../helpers/fake-opencode.ts";
import {
	isolateCiEnv,
	makePlugin,
	PLUGIN_JS,
	useFake,
} from "../helpers/run-ci.ts";
import { tempDir } from "../helpers/tmp.ts";

isolateCiEnv();

describe("run inputs and evidence dirs", () => {
	test("a second run in the same out dir never sees the first run's evidence", async () => {
		const called: FakeRun = {
			toolCalls: [{ tool: "echo_tool", result: { content: "echo:hi" } }],
		};
		// Run 1: tier 1, then the scenario (the tool is called).
		// Run 2: tier 1, then the scenario (the tool is NOT called).
		useFake([{}, called, {}, {}]);
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/scenarios/echo.yaml":
				"id: echo\nmode: scripted\nprompt: hi\nscript:\n  - text: done\nexpect:\n  tools:\n    - name: echo_tool\n",
		});
		const first = await runCi({ cwd, quiet: true });
		expect(first.exitCode).toBe(0);
		const second = await runCi({ cwd, quiet: true });
		expect(second.exitCode).toBe(1);
	});

	test("resetDir refuses paths outside the root", () => {
		const root = tempDir("reset-root-");
		expect(() => resetDir(join(root, ".."), root)).toThrow("refusing to reset");
		expect(() => resetDir(root, root)).toThrow("refusing to reset");
		resetDir(join(root, "2.0.26", "load"), root);
	});

	test("an unknown --scenario id is a configuration error", async () => {
		useFake([{}]);
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/scenarios/smoke.yaml":
				"id: smoke\nmode: scripted\nprompt: hi\nscript:\n  - text: done\n",
		});
		await expect(
			runCi({ cwd, scenarios: ["smok"], quiet: true }),
		).rejects.toThrow("unknown --scenario id(s): smok (known: smoke).");
	});

	test("--opencode accepts x.y.z and latest, rejects path syntax", () => {
		expect(parseRunArgs(["--opencode", "2.0.26,latest"]).opencodes).toEqual([
			"2.0.26",
			"latest",
		]);
		expect(() => parseRunArgs(["--opencode", "../.."])).toThrow(
			'Invalid --opencode "../..": expected x.y.z or "latest".',
		);
	});
});
