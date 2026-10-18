// M11: offline unit tests for the live tier (no opencode binary, no network).
// Every case below returns before any spawn: model passthrough needs no
// `opencode models` call, and the skip paths never reach a sandbox.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, ScenarioSchema } from "../../src/config/schema.ts";
import {
	budgetExhaustedReason,
	collectLiveKeys,
	noKeySkipReason,
	resolveModel,
	runLiveScenario,
} from "../../src/tiers/live.ts";

const SAVED: Record<string, string | undefined> = {};

function clearKeyEnv(): void {
	for (const name of ["OPENCODE_API_KEY", "CUSTOM_LIVE_KEY"]) {
		SAVED[name] = process.env[name];
		delete process.env[name];
	}
}

afterEach(() => {
	for (const [name, value] of Object.entries(SAVED)) {
		if (value === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = value;
		}
		delete SAVED[name];
	}
});

function config() {
	return ConfigSchema.parse({});
}

function liveScenario() {
	return ScenarioSchema.parse({
		id: "live-smoke",
		description: "live smoke",
		mode: "live",
		prompt: "Use the echo tool on the word hi and show me its output.",
		expect: {},
	});
}

describe("collectLiveKeys", () => {
	test("picks up set keys and ignores unset ones", () => {
		clearKeyEnv();
		process.env.CUSTOM_LIVE_KEY = "secret-value";
		const cfg = ConfigSchema.parse({
			live: { keys: ["OPENCODE_API_KEY", "CUSTOM_LIVE_KEY"] },
		});
		const keys = collectLiveKeys(cfg);
		expect(keys).toEqual({ CUSTOM_LIVE_KEY: "secret-value" });
	});

	test("empty values do not count", () => {
		clearKeyEnv();
		process.env.OPENCODE_API_KEY = "";
		expect(collectLiveKeys(config())).toEqual({});
	});
});

describe("skip reasons", () => {
	test("no-key reason names the configured keys, never values", () => {
		clearKeyEnv();
		process.env.OPENCODE_API_KEY = "super-secret";
		const cfg = ConfigSchema.parse({});
		const reason = noKeySkipReason(cfg);
		expect(reason).toContain("OPENCODE_API_KEY");
		expect(reason).not.toContain("super-secret");
		expect(reason).toMatch(/^no API key \(set one of: /);
	});

	test("budget reason shows spent and limit", () => {
		expect(budgetExhaustedReason({ spent: 1, limit: 2.5 })).toBe(
			"budget exhausted ($1.00 of $2.50)",
		);
	});
});

describe("resolveModel", () => {
	test("a provider/model value is used as is without spawning", () => {
		return expect(
			resolveModel({
				opencodeBin: "/nonexistent/opencode",
				keys: {},
				preferred: "opencode/sonnet",
			}),
		).resolves.toBe("opencode/sonnet");
	});
});

describe("runLiveScenario skips", () => {
	test("no API key skips without spawning opencode", async () => {
		clearKeyEnv();
		const result = await runLiveScenario({
			scenario: liveScenario(),
			config: config(),
			pluginPath: "/nonexistent/plugin",
			serverEntry: "/nonexistent/server.ts",
			opencodeBin: "/nonexistent/opencode",
			outDir: mkdtempSync(join(tmpdir(), "live-nokey-")),
			version: "2.0.26",
			budget: { spent: 0, limit: 1 },
		});
		expect(result.tier).toBe("live");
		expect(result.pass).toBe(true);
		expect(result.skipped ?? "").toContain("no API key");
		expect(result.skipped ?? "").toContain("OPENCODE_API_KEY");
	});

	test("exhausted budget skips without spawning opencode", async () => {
		const result = await runLiveScenario({
			scenario: liveScenario(),
			config: config(),
			pluginPath: "/nonexistent/plugin",
			serverEntry: "/nonexistent/server.ts",
			opencodeBin: "/nonexistent/opencode",
			outDir: mkdtempSync(join(tmpdir(), "live-budget-")),
			version: "2.0.26",
			budget: { spent: 1, limit: 1 },
			model: "opencode/fake-model",
			keys: { OPENCODE_API_KEY: "fake" },
		});
		expect(result.pass).toBe(true);
		expect(result.skipped).toBe("budget exhausted ($1.00 of $1.00)");
		expect(result.attempts).toEqual([]);
	});
});
