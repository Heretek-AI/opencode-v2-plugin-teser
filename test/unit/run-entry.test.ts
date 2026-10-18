// Review B1, B2, S2 and the install/build exit code: install and build run
// before entries are resolved, tier 1 loads the configured plugin.entry, a
// missing plugin.entry is a configuration error, and a failing build is the
// plugin's failure (exit 1), not a configuration error (exit 2).
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigError } from "../../src/config/load.ts";
import { resolveEntries } from "../../src/plugin/entry.ts";
import { StepError } from "../../src/plugin/install.ts";
import { runCi } from "../../src/run.ts";
import {
	isolateCiEnv,
	makePlugin,
	PLUGIN_JS,
	useFake,
} from "../helpers/run-ci.ts";
import { tempDir } from "../helpers/tmp.ts";

isolateCiEnv();

const SHIM = ".opencode-ci/out/2.0.26/load/plugin-under-test/server.js";

describe("entries and the install/build steps", () => {
	test("runs plugin.build before resolving a dist/ entry", async () => {
		useFake([{}]);
		const cwd = makePlugin({
			"package.json":
				'{ "name": "fixture-built", "type": "module", "main": "./dist/server.js" }',
			"src/server.js": PLUGIN_JS,
			".opencode-ci/config.yaml":
				"plugin:\n  build: mkdir -p dist && cp src/server.js dist/server.js\n",
		});
		const outcome = await runCi({ cwd, tiers: ["load"], quiet: true });
		expect(outcome.exitCode).toBe(0);
		expect(readFileSync(join(cwd, SHIM), "utf8")).toContain("/dist/server.js");
	});

	test("tier 1 loads plugin.entry, not auto-detection", async () => {
		useFake([{}]);
		const cwd = makePlugin({
			"package.json": '{ "name": "fixture-explicit", "type": "module" }',
			"src/plugin.ts": PLUGIN_JS,
			".opencode-ci/config.yaml": "plugin:\n  entry: src/plugin.ts\n",
		});
		const outcome = await runCi({ cwd, tiers: ["load"], quiet: true });
		expect(outcome.exitCode).toBe(0);
		expect(readFileSync(join(cwd, SHIM), "utf8")).toContain("/src/plugin.ts");
	});

	test("a missing plugin.entry is a configuration error even when index.ts exists", async () => {
		useFake([{}]);
		const cwd = makePlugin({
			"package.json": '{ "name": "fixture-typo", "type": "module" }',
			"index.ts": PLUGIN_JS,
			".opencode-ci/config.yaml": "plugin:\n  entry: src/typo.ts\n",
		});
		await expect(runCi({ cwd, tiers: ["load"], quiet: true })).rejects.toThrow(
			ConfigError,
		);
	});

	test("an explicit entry still resolves the TUI entry", () => {
		const dir = tempDir("entry-both-");
		mkdirSync(join(dir, "src"));
		writeFileSync(join(dir, "src/plugin.ts"), PLUGIN_JS);
		writeFileSync(join(dir, "tui.ts"), PLUGIN_JS);
		const entries = resolveEntries(dir, "src/plugin.ts");
		expect(entries.server).toBe(join(dir, "src/plugin.ts"));
		expect(entries.tui).toBe(join(dir, "tui.ts"));
	});

	test("a failing build is the plugin's failure, not a config error", async () => {
		useFake([{}]);
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/config.yaml": "plugin:\n  build: exit 3\n",
		});
		await expect(runCi({ cwd, quiet: true })).rejects.toThrow(StepError);
		await expect(runCi({ cwd, quiet: true })).rejects.toThrow(
			"build step failed (exit 3): exit code 3.",
		);
	});
});
