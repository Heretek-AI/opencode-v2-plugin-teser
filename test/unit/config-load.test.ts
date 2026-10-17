// M7: config/scenario file loading: precedence, duplicates, defaults,
// parse errors and fixture coverage.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	ConfigError,
	loadAll,
	loadConfig,
	loadScenarios,
} from "../../src/config/load.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES = join(REPO_ROOT, "test", "fixtures", "plugins");

function mkTree(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "opencode-ci-config-"));
	for (const [rel, content] of Object.entries(files)) {
		const abs = join(root, rel);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, content);
	}
	return root;
}

const PASS_SCENARIO = `id: my-case
mode: scripted
prompt: Hello.
script:
  - text: ok
expect:
  exitCode: 0
`;

describe("loadConfig", () => {
	test("YAML vs JSON precedence error names both files", () => {
		const root = mkTree({
			".opencode-ci/config.yaml": "plugin:\n  path: .\n",
			".opencode-ci/config.json": "{}",
		});
		let error: unknown;
		try {
			loadConfig(root);
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(ConfigError);
		expect(String((error as Error).message)).toMatch(/config\.yaml/);
		expect(String((error as Error).message)).toMatch(/config\.json/);
	});

	test("missing config yields defaults with a warning", () => {
		const root = mkTree({});
		const { config, configPath, warnings } = loadConfig(root);
		expect(configPath).toBeUndefined();
		expect(warnings.length).toBeGreaterThan(0);
		expect(config.plugin.path).toBe(".");
		expect(config.opencode.versions).toEqual(["2.0.26"]);
		expect(config.logLevel).toBe("info");
	});

	test("YAML parse error includes path and line", () => {
		const root = mkTree({
			".opencode-ci/config.yaml": "plugin:\n  path: [unclosed\n  bad indent\n",
		});
		let error: unknown;
		try {
			loadConfig(root);
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(ConfigError);
		const message = String((error as Error).message);
		expect(message).toMatch(/config\.yaml/);
		expect(message).toMatch(/line \d+/i);
	});

	test("invalid JSON config names the file", () => {
		const root = mkTree({ ".opencode-ci/config.json": "{oops" });
		expect(() => loadConfig(root)).toThrow(ConfigError);
		try {
			loadConfig(root);
		} catch (e) {
			expect(String((e as Error).message)).toMatch(/config\.json/);
		}
	});

	test("schema violation names the file and the field", () => {
		const root = mkTree({
			".opencode-ci/config.yaml": "expect:\n  tool: [my_tool]\n",
		});
		try {
			loadConfig(root);
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(ConfigError);
			expect(String((e as Error).message)).toMatch(/config\.yaml/);
			expect(String((e as Error).message)).toMatch(/expect/);
		}
	});

	test("JSON config parses with the same schema", () => {
		const root = mkTree({
			".opencode-ci/config.json": JSON.stringify({
				plugin: { path: "packages/p" },
				logLevel: "all",
			}),
		});
		const { config, configPath } = loadConfig(root);
		expect(configPath).toMatch(/config\.json$/);
		expect(config.plugin.path).toBe("packages/p");
		expect(config.logLevel).toBe("all");
	});
});

describe("loadScenarios", () => {
	test("duplicate ids error names the id and both files", () => {
		const root = mkTree({
			".opencode-ci/scenarios/a.yaml": PASS_SCENARIO,
			".opencode-ci/scenarios/b.yaml": PASS_SCENARIO,
		});
		try {
			loadScenarios(root);
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(ConfigError);
			const message = String((e as Error).message);
			expect(message).toMatch(/my-case/);
			expect(message).toMatch(/a\.yaml/);
			expect(message).toMatch(/b\.yaml/);
		}
	});

	test("scenario schema violation names the file and the field", () => {
		const root = mkTree({
			".opencode-ci/scenarios/bad.yaml": `id: bad
mode: scripted
prompt: hi
script:
  - text: ok
judge: { rubric: "live only" }
`,
		});
		try {
			loadScenarios(root);
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(ConfigError);
			expect(String((e as Error).message)).toMatch(/bad\.yaml/);
			expect(String((e as Error).message)).toMatch(/judge/);
		}
	});

	test("scenarios come back sorted by filename, yaml + yml + json", () => {
		const root = mkTree({
			".opencode-ci/scenarios/c.json": JSON.stringify({
				id: "c-case",
				mode: "scripted",
				prompt: "hi",
				script: [{ text: "ok" }],
			}),
			".opencode-ci/scenarios/a.yaml": PASS_SCENARIO.replace(
				"my-case",
				"a-case",
			),
			".opencode-ci/scenarios/b.yml": PASS_SCENARIO.replace(
				"my-case",
				"b-case",
			),
		});
		const scenarios = loadScenarios(root);
		expect(scenarios.map((s) => s.id)).toEqual(["a-case", "b-case", "c-case"]);
	});

	test("missing scenarios dir yields no scenarios", () => {
		expect(loadScenarios(mkTree({}))).toEqual([]);
	});
});

describe("fixtures still parse", () => {
	const names = readdirSync(FIXTURES).sort();
	test("every fixture plugin loads config + scenarios", () => {
		expect(names.length).toBeGreaterThan(0);
		for (const name of names) {
			const { config, scenarios } = loadAll(join(FIXTURES, name));
			expect(
				scenarios.length,
				`${name} should define at least one scenario`,
			).toBeGreaterThan(0);
			expect(config.plugin.path).toBe(".");
		}
	});

	test("tool-basic pass scenario keeps its shape", () => {
		const { scenarios } = loadAll(join(FIXTURES, "tool-basic"));
		const pass = scenarios.find((s) => s.id === "tool-basic-pass");
		expect(pass?.mode).toBe("scripted");
		expect(pass?.script?.length).toBe(2);
		expect(pass?.expect.tools?.[0]?.name).toBe("echo_tool");
	});
});
