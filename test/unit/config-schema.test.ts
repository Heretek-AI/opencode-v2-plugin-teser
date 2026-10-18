// M7: schema defaults, strictness and cross-field rules.
import { describe, expect, test } from "bun:test";
import {
	ConfigSchema,
	MatcherSchema,
	ScenarioSchema,
} from "../../src/config/schema.ts";

const scriptedBase = {
	id: "ok-case",
	mode: "scripted",
	prompt: "hi",
	script: [{ text: "done" }],
	expect: { exitCode: 0 },
};

describe("ConfigSchema defaults", () => {
	test("empty object yields every default", () => {
		const config = ConfigSchema.parse({});
		expect(config.plugin.path).toBe(".");
		expect(config.plugin.options).toEqual({});
		expect(config.plugin.ui).toBeUndefined();
		expect(config.opencode.versions).toEqual(["2.0.26"]);
		expect(config.expect).toEqual({
			tools: [],
			commands: [],
			agents: [],
			skills: [],
			mcp: [],
		});
		expect(config.live.keys).toEqual(["OPENCODE_API_KEY"]);
		expect(config.live.repeat).toBe(3);
		expect(config.live.pass).toBe(2);
		expect(config.live.budgetUSD).toBe(1);
		expect(config.live.timeoutMs).toBe(240_000);
		expect(config.gate.enabled).toBe(true);
		expect(config.gate.bootstrap).toBe("fail");
		expect(config.gate.workflow).toBeUndefined();
		expect(config.logLevel).toBe("info");
	});

	test("partial blocks keep their defaults", () => {
		const config = ConfigSchema.parse({ live: { model: "opencode/x" } });
		expect(config.live.model).toBe("opencode/x");
		expect(config.live.repeat).toBe(3);
		expect(config.live.pass).toBe(2);
	});

	test("versions accepts semver and latest, non-empty only", () => {
		expect(
			ConfigSchema.parse({ opencode: { versions: ["2.0.26", "latest"] } })
				.opencode.versions,
		).toEqual(["2.0.26", "latest"]);
		expect(ConfigSchema.safeParse({ opencode: { versions: [] } }).success).toBe(
			false,
		);
		expect(
			ConfigSchema.safeParse({ opencode: { versions: ["v2"] } }).success,
		).toBe(false);
		expect(
			ConfigSchema.safeParse({ opencode: { versions: ["2.0"] } }).success,
		).toBe(false);
	});
});

describe("strictness: unknown keys fail", () => {
	test("expect.tool typo fails", () => {
		const parsed = ConfigSchema.safeParse({ expect: { tool: ["x"] } });
		expect(parsed.success).toBe(false);
	});

	test("unknown top-level config key fails", () => {
		expect(ConfigSchema.safeParse({ bogus: 1 }).success).toBe(false);
	});

	test("unknown plugin key fails", () => {
		expect(
			ConfigSchema.safeParse({ plugin: { path: ".", bogus: 1 } }).success,
		).toBe(false);
	});

	test("unknown scenario key fails", () => {
		expect(
			ScenarioSchema.safeParse({ ...scriptedBase, bogus: 1 }).success,
		).toBe(false);
	});

	test("unknown matcher key fails", () => {
		expect(MatcherSchema.safeParse({ containz: "x" }).success).toBe(false);
	});

	test("unknown expect key fails", () => {
		expect(
			ScenarioSchema.safeParse({
				...scriptedBase,
				expect: { exitCode: 0, bogus: 1 },
			}).success,
		).toBe(false);
	});
});

describe("cross-field rules", () => {
	test("request is forbidden in live mode", () => {
		const parsed = ScenarioSchema.safeParse({
			id: "live-x",
			mode: "live",
			prompt: "hi",
			expect: { request: { system: { contains: "x" } } },
		});
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues[0]?.message).toMatch(/expect\.request.*live/);
		}
	});

	test("script is required in scripted mode", () => {
		const { script: _dropped, ...noScript } = scriptedBase;
		const parsed = ScenarioSchema.safeParse(noScript);
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues[0]?.message).toMatch(/"script".*required/);
		}
	});

	test("script is forbidden in live mode", () => {
		const parsed = ScenarioSchema.safeParse({
			id: "live-x",
			mode: "live",
			prompt: "hi",
			script: [{ text: "x" }],
		});
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues[0]?.message).toMatch(/"script".*forbidden/);
		}
	});

	test("judge is live-only", () => {
		const parsed = ScenarioSchema.safeParse({
			...scriptedBase,
			judge: { rubric: "good?" },
		});
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues[0]?.message).toMatch(/"judge".*live-only/);
		}
	});

	test("judgeReply is no longer a scenario field", () => {
		const parsed = ScenarioSchema.safeParse({
			...scriptedBase,
			judgeReply: '{"pass":true}',
		});
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues[0]?.message).toMatch(/judgeReply/);
		}
	});

	test("removed config fields fail validation instead of being ignored", () => {
		for (const raw of [
			{ expect: { providers: ["p"] } },
			{ expect: { models: ["m"] } },
			{ gate: { window: 10 } },
			{ gate: { threshold: 0.5 } },
		]) {
			expect(ConfigSchema.safeParse(raw).success).toBe(false);
		}
	});

	test("live judge scenario validates", () => {
		const parsed = ScenarioSchema.safeParse({
			id: "live-x",
			mode: "live",
			prompt: "hi",
			judge: { rubric: "The reply is helpful." },
		});
		expect(parsed.success).toBe(true);
	});

	test("pass must be <= repeat", () => {
		const bad = ConfigSchema.safeParse({
			live: { repeat: 3, pass: 4 },
		});
		expect(bad.success).toBe(false);
		if (!bad.success) {
			expect(bad.error.issues[0]?.message).toMatch(/live\.pass.*live\.repeat/);
		}
		expect(
			ConfigSchema.safeParse({ live: { repeat: 2, pass: 2 } }).success,
		).toBe(true);
	});
});

describe("matchers", () => {
	test("leading (?i) is accepted as a matches string", () => {
		expect(MatcherSchema.safeParse({ matches: "(?i)unhandled" }).success).toBe(
			true,
		);
		expect(
			MatcherSchema.safeParse({ notMatches: "(?i)unhandled" }).success,
		).toBe(true);
	});

	test("empty matcher fails", () => {
		const parsed = MatcherSchema.safeParse({});
		expect(parsed.success).toBe(false);
	});

	test("every matcher key validates", () => {
		expect(
			MatcherSchema.safeParse({
				equals: 1,
				contains: "a",
				notContains: "b",
				matches: "c",
				notMatches: "d",
				includes: ["e"],
				exists: true,
				count: { gte: 1, lte: 2, eq: 1 },
			}).success,
		).toBe(true);
	});
});

describe("scenario ids and shapes", () => {
	test("bad ids fail", () => {
		for (const id of ["Bad", "-x", "a_b", "", "A"]) {
			expect(ScenarioSchema.safeParse({ ...scriptedBase, id }).success).toBe(
				false,
			);
		}
		expect(
			ScenarioSchema.safeParse({ ...scriptedBase, id: "a-b-9" }).success,
		).toBe(true);
	});

	test("workspace record and plugin options validate", () => {
		const parsed = ScenarioSchema.safeParse({
			...scriptedBase,
			plugin: { options: { mode: "strict" } },
			workspace: { ".env": "API_KEY=sk-test\n" },
		});
		expect(parsed.success).toBe(true);
	});

	test("scenario timeoutMs has no schema default (tiers apply their own)", () => {
		const parsed = ScenarioSchema.safeParse(scriptedBase);
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.timeoutMs).toBeUndefined();
			expect(parsed.data.expect.exitCode).toBe(0);
			expect(parsed.data.expect.noErrors).toBe(true);
		}
	});
});
