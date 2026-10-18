// Unit tests for the flake-gate orchestration (src/gate/gate.ts) and
// history fetching (src/gate/history.ts). History and prerequisites are
// injected, so no test touches the network or `gh`.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Config, ConfigSchema } from "../../src/config/schema.ts";
import {
	formatGateSection,
	gateApplies,
	readAcknowledgments,
	runGate,
} from "../../src/gate/gate.ts";
import {
	type FetchHistoryOptions,
	fetchHistory,
	gatePrerequisites,
	parseWorkflowName,
	resolveWorkflowName,
} from "../../src/gate/history.ts";
import type { GateHistoryRun } from "../../src/gate/verdict.ts";
import type { CaseResult } from "../../src/report/results.ts";
import { createLogger } from "../../src/util/log.ts";

const logger = createLogger({ quiet: true });

function baseConfig(overrides?: Partial<Config["gate"]>): Config {
	const config = ConfigSchema.parse({});
	return { ...config, gate: { ...config.gate, ...overrides } };
}

function liveRow(
	id: string,
	pass: boolean,
	extra?: Partial<CaseResult>,
): CaseResult {
	return {
		id,
		tier: "live",
		opencode: "2.0.26",
		pass,
		durationMs: 10,
		...extra,
	};
}

function historyRun(
	id: string,
	at: string,
	passes: Record<string, boolean>,
): GateHistoryRun {
	return { id, at, passes };
}

/** N identical sampled history runs, newest first. */
function historyRuns(
	n: number,
	passes: Record<string, boolean>,
): GateHistoryRun[] {
	return Array.from({ length: n }, (_, i) =>
		historyRun(`run-${i}`, "2026-10-01T00:00:00Z", { ...passes }),
	);
}

describe("parseWorkflowName", () => {
	test("extracts the file from a full workflow ref", () => {
		expect(
			parseWorkflowName("owner/repo/.github/workflows/ci.yml@refs/heads/main"),
		).toBe("ci.yml");
	});

	test("returns undefined for missing, empty, or foreign refs", () => {
		expect(parseWorkflowName(undefined)).toBeUndefined();
		expect(parseWorkflowName("")).toBeUndefined();
		expect(parseWorkflowName("owner/repo@refs/heads/main")).toBeUndefined();
		expect(
			parseWorkflowName("owner/repo/.github/workflows/@refs/heads/main"),
		).toBeUndefined();
	});

	test("resolves explicit config first, then the env ref", () => {
		expect(
			resolveWorkflowName("explicit.yml", {
				GITHUB_WORKFLOW_REF: "o/r/.github/workflows/ci.yml@ref",
			}),
		).toBe("explicit.yml");
		expect(
			resolveWorkflowName(undefined, {
				GITHUB_WORKFLOW_REF: "o/r/.github/workflows/ci.yml@ref",
			}),
		).toBe("ci.yml");
		expect(resolveWorkflowName(undefined, {})).toBeUndefined();
	});
});

describe("readAcknowledgments", () => {
	test("absent file defaults to empty (unlike IUMBTEMS)", () => {
		const cwd = mkdtempSync(join(tmpdir(), "opencode-ci-gate-"));
		expect(readAcknowledgments(cwd)).toEqual({
			version: 1,
			acknowledgments: [],
		});
	});

	test("present valid file parses; malformed file throws", () => {
		const cwd = mkdtempSync(join(tmpdir(), "opencode-ci-gate-"));
		mkdirSync(join(cwd, ".opencode-ci"), { recursive: true });
		const path = join(cwd, ".opencode-ci", "acknowledgments.json");
		writeFileSync(
			path,
			JSON.stringify({
				version: 1,
				acknowledgments: [
					{
						case: "a",
						reason: "why",
						issue: "https://example.test/i/1",
						date: "2026-10-12",
					},
				],
			}),
			"utf8",
		);
		expect(readAcknowledgments(cwd).acknowledgments).toHaveLength(1);
		writeFileSync(
			path,
			JSON.stringify({ version: 2, acknowledgments: [] }),
			"utf8",
		);
		expect(() => readAcknowledgments(cwd)).toThrow();
		writeFileSync(path, "not json", "utf8");
		expect(() => readAcknowledgments(cwd)).toThrow();
	});

	test("entries missing issue or date are malformed (verbatim parser)", () => {
		const cwd = mkdtempSync(join(tmpdir(), "opencode-ci-gate-"));
		mkdirSync(join(cwd, ".opencode-ci"), { recursive: true });
		const path = join(cwd, ".opencode-ci", "acknowledgments.json");
		writeFileSync(
			path,
			JSON.stringify({
				version: 1,
				acknowledgments: [{ case: "a", reason: "why" }],
			}),
			"utf8",
		);
		expect(() => readAcknowledgments(cwd)).toThrow();
	});
});

describe("gateApplies", () => {
	const config = baseConfig();
	const live = [liveRow("a", true)];

	test("requires live rows, enabled gate, and flag or CI", () => {
		expect(
			gateApplies({ results: live, config, gateFlag: true, env: {} }),
		).toBe(true);
		expect(
			gateApplies({
				results: live,
				config,
				gateFlag: false,
				env: { GITHUB_ACTIONS: "true" },
			}),
		).toBe(true);
		expect(
			gateApplies({ results: live, config, gateFlag: false, env: {} }),
		).toBe(false);
		expect(
			gateApplies({
				results: [],
				config,
				gateFlag: true,
				env: {},
			}),
		).toBe(false);
		expect(
			gateApplies({
				results: live,
				config: baseConfig({ enabled: false }),
				gateFlag: true,
				env: {},
			}),
		).toBe(false);
	});

	test("skipped-only live rows do not count as a live run", () => {
		const skipped = [liveRow("a", true, { skipped: "no API key" })];
		expect(
			gateApplies({ results: skipped, config, gateFlag: true, env: {} }),
		).toBe(false);
	});
});

describe("runGate exit-code mapping (history injected)", () => {
	const ciEnv = {
		GITHUB_ACTIONS: "true",
		GITHUB_REPOSITORY: "o/r",
		GITHUB_REF_NAME: "main",
		GITHUB_WORKFLOW_REF: "o/r/.github/workflows/ci.yml@refs/heads/main",
		GH_TOKEN: "fake",
	};
	const prereqOk = async () => ({ ok: true }) as const;

	test("green verdict exits 0", async () => {
		const outcome = await runGate({
			cwd: mkdtempSync(join(tmpdir(), "opencode-ci-gate-")),
			config: baseConfig(),
			results: [liveRow("a", true)],
			requiredVersion: "2.0.26",
			gateFlag: true,
			env: ciEnv,
			logger,
			prereqFn: prereqOk,
			fetchHistoryFn: async () => historyRuns(5, { a: true }),
		});
		expect(outcome.ran).toBe(true);
		expect(outcome.exitCode).toBe(0);
		expect(outcome.verdict?.exit).toBe(0);
		expect(outcome.section).toContain("## Flake gate");
	});

	test("stable failure exits 1 (regression)", async () => {
		const outcome = await runGate({
			cwd: mkdtempSync(join(tmpdir(), "opencode-ci-gate-")),
			config: baseConfig(),
			results: [liveRow("a", false, { failures: ["boom"] })],
			requiredVersion: "2.0.26",
			gateFlag: true,
			env: ciEnv,
			logger,
			prereqFn: prereqOk,
			fetchHistoryFn: async () => historyRuns(5, { a: true }),
		});
		expect(outcome.ran).toBe(true);
		expect(outcome.exitCode).toBe(1);
		expect(outcome.verdict?.exit).toBe(1);
		expect(outcome.verdict?.message).toContain("a");
	});

	test("flaky failure exits 0 (green)", async () => {
		const history: GateHistoryRun[] = [
			historyRun("r4", "2026-10-05T00:00:00Z", { a: true }),
			historyRun("r3", "2026-10-04T00:00:00Z", { a: false }),
			historyRun("r2", "2026-10-03T00:00:00Z", { a: true }),
			historyRun("r1", "2026-10-02T00:00:00Z", { a: false }),
			historyRun("r0", "2026-10-01T00:00:00Z", { a: true }),
		];
		const outcome = await runGate({
			cwd: mkdtempSync(join(tmpdir(), "opencode-ci-gate-")),
			config: baseConfig(),
			results: [liveRow("a", false, { failures: ["boom"] })],
			requiredVersion: "2.0.26",
			gateFlag: true,
			env: ciEnv,
			logger,
			prereqFn: prereqOk,
			fetchHistoryFn: async () => history,
		});
		expect(outcome.exitCode).toBe(0);
		expect(outcome.verdict?.exit).toBe(0);
	});

	test("no history exits 2, or 0 with bootstrap allow", async () => {
		const ctx = {
			cwd: mkdtempSync(join(tmpdir(), "opencode-ci-gate-")),
			results: [liveRow("a", false, { failures: ["boom"] })],
			requiredVersion: "2.0.26",
			gateFlag: true,
			env: ciEnv,
			logger,
			prereqFn: prereqOk,
			fetchHistoryFn: async () => [] as GateHistoryRun[],
		};
		const strict = await runGate({ ...ctx, config: baseConfig() });
		expect(strict.exitCode).toBe(2);
		expect(strict.verdict?.exit).toBe(2);
		const allowed = await runGate({
			...ctx,
			config: baseConfig({ bootstrap: "allow" }),
		});
		expect(allowed.exitCode).toBe(0);
		expect(allowed.verdict?.exit).toBe(2);
	});

	test("malformed acknowledgments exit 1", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "opencode-ci-gate-"));
		mkdirSync(join(cwd, ".opencode-ci"), { recursive: true });
		writeFileSync(
			join(cwd, ".opencode-ci", "acknowledgments.json"),
			"not json",
			"utf8",
		);
		const outcome = await runGate({
			cwd,
			config: baseConfig(),
			results: [liveRow("a", true)],
			requiredVersion: "2.0.26",
			gateFlag: true,
			env: ciEnv,
			logger,
			prereqFn: prereqOk,
			fetchHistoryFn: async () => [],
		});
		expect(outcome.ran).toBe(true);
		expect(outcome.exitCode).toBe(1);
	});

	test("missing prerequisites fall back to fail on any live failure", async () => {
		const noToken = { ...ciEnv, GH_TOKEN: "" };
		const prereqFail = async () => ({ ok: false, reason: "no token" }) as const;
		const failing = await runGate({
			cwd: mkdtempSync(join(tmpdir(), "opencode-ci-gate-")),
			config: baseConfig(),
			results: [liveRow("a", false, { failures: ["boom"] })],
			requiredVersion: "2.0.26",
			gateFlag: true,
			env: noToken,
			logger,
			prereqFn: prereqFail,
			fetchHistoryFn: async () => {
				throw new Error("must not be called without prerequisites");
			},
		});
		expect(failing.exitCode).toBe(1);
		expect(failing.fallback).toContain("fail on any live failure");
		expect(failing.section).toContain("Flake gate");

		const passing = await runGate({
			cwd: mkdtempSync(join(tmpdir(), "opencode-ci-gate-")),
			config: baseConfig(),
			results: [liveRow("a", true)],
			requiredVersion: "2.0.26",
			gateFlag: true,
			env: noToken,
			logger,
			prereqFn: prereqFail,
			fetchHistoryFn: async () => {
				throw new Error("must not be called without prerequisites");
			},
		});
		expect(passing.exitCode).toBe(0);
	});

	test("gate does not run when it does not apply", async () => {
		const outcome = await runGate({
			cwd: mkdtempSync(join(tmpdir(), "opencode-ci-gate-")),
			config: baseConfig(),
			results: [liveRow("a", false, { failures: ["boom"] })],
			requiredVersion: "2.0.26",
			gateFlag: false,
			env: {},
			logger,
			fetchHistoryFn: async () => {
				throw new Error("must not be called when the gate does not apply");
			},
		});
		expect(outcome).toEqual({ ran: false, exitCode: 0, section: "" });
	});
});

describe("formatGateSection", () => {
	test("renders status and message as markdown", () => {
		const section = formatGateSection(
			{
				exit: 1,
				message: 'REGRESSION in historically stable case(s): "a"',
			},
			{ requiredVersion: "2.0.26" },
		);
		expect(section).toContain("## Flake gate");
		expect(section).toContain("regression");
		expect(section).toContain('"a"');
	});
});

describe("fetchHistory (mocked gh)", () => {
	const opts: FetchHistoryOptions = {
		workflow: "ci.yml",
		branch: "main",
		repo: "o/r",
		artifact: "opencode-plugin-ci-results",
		requiredVersion: "2.0.26",
		tmpDir: mkdtempSync(join(tmpdir(), "opencode-ci-history-")),
	};

	function resultsFile(rows: Partial<CaseResult>[]): string {
		return JSON.stringify({
			version: 1,
			at: new Date(0).toISOString(),
			tool: "0.1.0",
			plugin: "p",
			results: rows.map((r) => ({
				id: "x",
				tier: "live",
				opencode: "2.0.26",
				pass: true,
				durationMs: 1,
				...r,
			})),
		});
	}

	test("lists runs newest first, skips failed downloads, keeps required live rows", async () => {
		const seen: string[][] = [];
		const history = await fetchHistory(opts, async (args) => {
			seen.push(args);
			if (args[1] === "list") {
				return {
					code: 0,
					stdout: JSON.stringify([
						{
							databaseId: 2,
							conclusion: "failure",
							createdAt: "2026-10-02T00:00:00Z",
						},
						{
							databaseId: 1,
							conclusion: "success",
							createdAt: "2026-10-01T00:00:00Z",
						},
					]),
					stderr: "",
				};
			}
			const id = args[2] as string;
			const dir = args[6] as string;
			if (id === "2") {
				mkdirSync(dir, { recursive: true });
				writeFileSync(
					join(dir, "results.json"),
					resultsFile([
						{ id: "a", pass: false },
						{ id: "b", tier: "scripted", pass: false },
						{ id: "c", opencode: "9.9.9", pass: false },
						{ id: "d", pass: false, skipped: "no key" },
					]),
					"utf8",
				);
				return { code: 0, stdout: "", stderr: "" };
			}
			return { code: 1, stdout: "", stderr: "no artifact" };
		});
		expect(history).toEqual([
			{
				id: "2",
				at: "2026-10-02T00:00:00Z",
				passes: { a: false },
			},
		]);
		expect(seen[0]?.slice(0, 2)).toEqual(["run", "list"]);
		expect(seen[0]).toContain("ci.yml");
	});

	test("gh list failure throws", async () => {
		await expect(
			fetchHistory(opts, async () => ({
				code: 1,
				stdout: "",
				stderr: "auth failed",
			})),
		).rejects.toThrow();
	});
});

describe("gatePrerequisites", () => {
	test("needs a token and a working gh", async () => {
		expect(
			await gatePrerequisites({}, async () => ({
				code: 0,
				stdout: "2.x",
				stderr: "",
			})),
		).toEqual({
			ok: false,
			reason: expect.stringContaining("GH_TOKEN"),
		});
		expect(
			await gatePrerequisites({ GH_TOKEN: "x" }, async () => {
				throw new Error("spawn failed");
			}),
		).toEqual({ ok: false, reason: expect.stringContaining("gh") });
		expect(
			await gatePrerequisites({ GITHUB_TOKEN: "x" }, async () => ({
				code: 0,
				stdout: "gh version 2.x",
				stderr: "",
			})),
		).toEqual({ ok: true });
	});
});
