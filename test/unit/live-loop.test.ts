// The live attempt loop (k-of-n, early stop, judge gating, budget), driven by
// the fake opencode binary so no real model or key is needed.
import { afterAll, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { ConfigSchema, ScenarioSchema } from "../../src/config/schema.ts";
import { type LiveBudget, runLiveScenario } from "../../src/tiers/live.ts";
import {
	type FakeRun,
	fakeRunCount,
	makeFakeOpencode,
} from "../helpers/fake-opencode.ts";
import { cleanupTempDirs, tempDir } from "../helpers/tmp.ts";

const PLUGIN = resolve(import.meta.dir, "../fixtures/plugins/tool-basic");
const ENTRY = join(PLUGIN, "src/server.ts");

const PASS: FakeRun = {
	text: "echo:hi",
	cost: 0.01,
	toolCalls: [
		{
			tool: "echo_tool",
			input: { text: "hi" },
			result: { content: "echo:hi" },
		},
	],
};
const FAIL: FakeRun = { text: "I did not use the tool", cost: 0.01 };

async function live(
	runs: FakeRun[],
	opts: { budget?: LiveBudget; judge?: boolean } = {},
) {
	const dir = tempDir("live-loop-");
	const bin = makeFakeOpencode(dir, { runs });
	const config = ConfigSchema.parse({ live: { model: "fake/model" } });
	const scenario = ScenarioSchema.parse({
		id: "live-smoke",
		mode: "live",
		prompt: "Use the echo tool on the word hi",
		expect: { tools: [{ name: "echo_tool" }] },
		...(opts.judge ? { judge: { rubric: "The reply shows echo:hi." } } : {}),
	});
	const result = await runLiveScenario({
		scenario,
		config,
		pluginPath: PLUGIN,
		serverEntry: ENTRY,
		opencodeBin: bin,
		outDir: join(dir, "out"),
		version: "2.0.26",
		budget: opts.budget ?? { spent: 0, limit: 1 },
		model: "fake/model",
		keys: { OPENCODE_API_KEY: "fake" },
	});
	return { result, runs: fakeRunCount(dir) };
}

afterAll(cleanupTempDirs);

describe("live attempt loop", () => {
	test("pass, fail, pass passes after 3 attempts", async () => {
		const { result, runs } = await live([PASS, FAIL, PASS]);
		expect(result.pass).toBe(true);
		expect(result.skipped).toBeUndefined();
		expect(result.attempts?.map((a) => a.pass)).toEqual([true, false, true]);
		expect(runs).toBe(3);
	});

	test("stops early after 2 passes", async () => {
		const { result, runs } = await live([PASS, PASS, PASS]);
		expect(result.pass).toBe(true);
		expect(result.attempts).toHaveLength(2);
		expect(runs).toBe(2);
	});

	test("stops early once passing is impossible", async () => {
		const { result, runs } = await live([FAIL, FAIL, PASS]);
		expect(result.pass).toBe(false);
		expect(result.attempts).toHaveLength(2);
		expect(runs).toBe(2);
		expect((result.failures ?? []).join("\n")).toContain(
			"0 of 2 attempt(s) passed, needed 2 of 3",
		);
	});

	test("the judge runs only after the deterministic checks pass", async () => {
		const verdict: FakeRun = { text: '{"pass":true,"reason":"ok"}' };
		const { result, runs } = await live([FAIL, FAIL], { judge: true });
		expect(result.pass).toBe(false);
		expect(result.judge).toBeUndefined();
		expect(runs).toBe(2);
		const judged = await live([PASS, verdict, PASS, verdict], { judge: true });
		expect(judged.result.pass).toBe(true);
		expect(judged.result.judge).toEqual({ pass: true, reason: "ok" });
		expect(judged.runs).toBe(4);
	});

	test("running out of budget after a failed attempt is a failure, not a skip", async () => {
		const { result, runs } = await live([{ ...FAIL, cost: 1.5 }]);
		expect(runs).toBe(1);
		expect(result.skipped).toBeUndefined();
		expect(result.pass).toBe(false);
		expect(result.failures?.[0]).toBe(
			"live scenario live-smoke: 0 of 1 attempt(s) passed, needed 2 of 3 (budget exhausted ($1.50 of $1.00)).",
		);
	});

	test("running out of budget before any attempt is a skip", async () => {
		const { result, runs } = await live([PASS], {
			budget: { spent: 1, limit: 1 },
		});
		expect(runs).toBe(0);
		expect(result.pass).toBe(true);
		expect(result.skipped).toBe("budget exhausted ($1.00 of $1.00)");
	});
});
