// M9 acceptance (e2e, needs OPENCODE_BIN or the dev install at
// review/oc/node_modules/.bin/opencode): every fixture's pass scenarios pass
// and every fail scenario fails with the expected message.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { ConfigSchema, ScenarioSchema } from "../../src/config/schema.ts";
import { resolveEntries } from "../../src/plugin/entry.ts";
import { runScenario } from "../../src/tiers/scripted.ts";

const FIXTURES = resolve(import.meta.dir, "../fixtures/plugins");

function opencodeBin(): string {
	return (
		process.env.OPENCODE_BIN ??
		resolve(import.meta.dir, "../../review/oc/node_modules/.bin/opencode")
	);
}

interface Case {
	fixture: string;
	file: string;
	pass: boolean;
	contains?: string;
}

const CASES: Case[] = [
	{ fixture: "tool-basic", file: "pass.yaml", pass: true },
	{
		fixture: "tool-basic",
		file: "fail.yaml",
		pass: false,
		contains: 'expected to contain "echo:bye"',
	},
	{ fixture: "tool-direct", file: "pass.yaml", pass: true },
	{ fixture: "hook-mutate", file: "pass.yaml", pass: true },
	{ fixture: "shell-env", file: "pass.yaml", pass: true },
	{ fixture: "system-inject", file: "pass.yaml", pass: true },
	{ fixture: "event-file", file: "pass.yaml", pass: true },
];

describe("tier 2 (scripted)", () => {
	for (const item of CASES) {
		test(`${item.fixture}/${item.file} ${item.pass ? "passes" : "fails"}`, async () => {
			const pluginPath = join(FIXTURES, item.fixture);
			const raw = parseYaml(
				readFileSync(
					join(pluginPath, ".opencode-ci", "scenarios", item.file),
					"utf8",
				),
			) as unknown;
			const scenario = ScenarioSchema.parse(raw);
			const configRaw = parseYaml(
				readFileSync(join(pluginPath, ".opencode-ci", "config.yaml"), "utf8"),
			) as unknown;
			const config = ConfigSchema.parse(configRaw);
			const entries = resolveEntries(pluginPath);
			if (entries.server === undefined) {
				throw new Error(`no server entry for fixture ${item.fixture}`);
			}
			const result = await runScenario({
				scenario,
				config,
				pluginPath,
				serverEntry: entries.server,
				opencodeBin: opencodeBin(),
				outDir: mkdtempSync(join(tmpdir(), `tier2-${item.fixture}-`)),
				version: "2.0.26",
			});
			expect(result.id).toBe(scenario.id);
			expect(result.tier).toBe("scripted");
			expect(result.pass).toBe(item.pass);
			if (item.pass) {
				expect(result.failures).toBeUndefined();
			} else {
				const text = (result.failures ?? []).join("\n");
				expect(text).toContain(item.contains ?? "");
			}
			// Evidence is always written, pass or fail.
			expect(result.kept).toBeDefined();
		}, 600_000);
	}
});
