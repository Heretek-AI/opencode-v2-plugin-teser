// M11: unit tests for the judge prompt builder and verdict parser (no opencode).
import { describe, expect, test } from "bun:test";
import { classifyRequest } from "../../src/stub/stub.ts";
import {
	buildJudgePrompt,
	JUDGE_SENTINEL,
	JUDGE_SYSTEM,
	parseVerdict,
} from "../../src/tiers/judge.ts";

const REPLY_CONTRACT =
	'Reply with exactly one JSON object: {"pass": true|false, "reason": "<one sentence>"} and nothing else.';

describe("buildJudgePrompt", () => {
	test("starts with the sentinel line and ends with the reply contract", () => {
		const prompt = buildJudgePrompt({ rubric: "Be nice." });
		const lines = prompt.split("\n");
		expect(lines[0]).toBe(JUDGE_SENTINEL);
		expect(lines[0]).toBe("OPENCODE_PLUGIN_CI_JUDGE");
		expect(prompt.endsWith(REPLY_CONTRACT)).toBe(true);
		expect(prompt).toContain("Be nice.");
	});

	test("includes every non-empty evidence section", () => {
		const prompt = buildJudgePrompt({
			rubric: "R.",
			text: "model said hi",
			toolCalls: "- echo_tool completed",
			hookSummary: "- tool.before@post: 2",
			files: "=== a.txt ===\nhi",
		});
		for (const snippet of [
			"model said hi",
			"- echo_tool completed",
			"- tool.before@post: 2",
			"=== a.txt ===",
		]) {
			expect(prompt).toContain(snippet);
		}
	});

	test("omits empty sections", () => {
		const prompt = buildJudgePrompt({ rubric: "R.", text: "", files: "" });
		expect(prompt).not.toContain("Evidence: model text");
		expect(prompt).not.toContain("Evidence: files");
	});

	test("truncates each evidence section to 8000 chars", () => {
		const long = "x".repeat(9000);
		const prompt = buildJudgePrompt({ rubric: "R.", text: long });
		expect(prompt.length).toBeLessThan(9000 + 1000);
		expect(prompt).not.toContain(long);
		expect(prompt).toContain("x".repeat(8000));
	});

	test("the built prompt classifies as a judge request", () => {
		const prompt = buildJudgePrompt({ rubric: "R.", text: "hi" });
		expect(
			classifyRequest({ messages: [{ role: "user", content: prompt }] }),
		).toBe("judge");
	});

	test("JUDGE_SYSTEM is the exact M11 string", () => {
		expect(JUDGE_SYSTEM).toBe(
			"You grade whether recorded evidence satisfies a rubric. You cannot run tools. Be strict: if the evidence does not clearly show the rubric is met, fail it.",
		);
	});
});

describe("parseVerdict", () => {
	test("valid JSON passes through", () => {
		expect(parseVerdict('{"pass":true,"reason":"ok"}')).toEqual({
			pass: true,
			reason: "ok",
		});
		expect(parseVerdict('{"pass": false, "reason": "nope"}')).toEqual({
			pass: false,
			reason: "nope",
		});
	});

	test("extra prose around the JSON is tolerated", () => {
		expect(
			parseVerdict(
				'Here is my verdict:\n{"pass":true,"reason":"clearly shown"}\nThanks!',
			),
		).toEqual({ pass: true, reason: "clearly shown" });
	});

	test("pass as a string is rejected", () => {
		const verdict = parseVerdict('{"pass":"true","reason":"ok"}');
		expect(verdict.pass).toBe(false);
		expect(verdict.reason).toMatch(/^judge reply was not valid JSON: /);
	});

	test("missing reason is rejected", () => {
		const verdict = parseVerdict('{"pass":true}');
		expect(verdict.pass).toBe(false);
		expect(verdict.reason).toMatch(/^judge reply was not valid JSON: /);
	});

	test("malformed JSON is rejected with the first 200 chars", () => {
		const reply = `{pass:true, ${"z".repeat(300)}}`;
		const verdict = parseVerdict(reply);
		expect(verdict.pass).toBe(false);
		expect(verdict.reason).toBe(
			`judge reply was not valid JSON: ${reply.slice(0, 200)}`,
		);
	});

	test("no JSON at all is rejected", () => {
		const verdict = parseVerdict("I think it passed, probably.");
		expect(verdict).toEqual({
			pass: false,
			reason: "judge reply was not valid JSON: I think it passed, probably.",
		});
	});

	test("unbalanced braces are rejected", () => {
		const verdict = parseVerdict('{"pass":true,"reason":"ok"');
		expect(verdict.pass).toBe(false);
		expect(verdict.reason).toMatch(/^judge reply was not valid JSON: /);
	});

	test("braces inside strings do not break the block scan", () => {
		expect(
			parseVerdict('{"pass":true,"reason":"a {b} c"} trailing {x}'),
		).toEqual({ pass: true, reason: "a {b} c" });
	});

	test("the first balanced block wins, even when it is not JSON", () => {
		const verdict = parseVerdict("Note {this} is prose.");
		expect(verdict.pass).toBe(false);
		expect(verdict.reason).toMatch(/^judge reply was not valid JSON: /);
	});
});
