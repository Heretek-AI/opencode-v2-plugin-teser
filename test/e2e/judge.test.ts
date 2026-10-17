// M11 acceptance (e2e, needs OPENCODE_BIN or the dev install at
// review/oc/node_modules/.bin/opencode, but no network): the judge path runs
// offline through the stub via OPENCODE_PLUGIN_CI_JUDGE_VIA_STUB=1.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runJudge } from "../../src/tiers/judge.ts";

const HOOK = "OPENCODE_PLUGIN_CI_JUDGE_VIA_STUB";

function opencodeBin(): string {
	return (
		process.env.OPENCODE_BIN ??
		resolve(import.meta.dir, "../../review/oc/node_modules/.bin/opencode")
	);
}

let savedHook: string | undefined;

beforeEach(() => {
	savedHook = process.env[HOOK];
	process.env[HOOK] = "1";
});

afterEach(() => {
	if (savedHook === undefined) {
		delete process.env[HOOK];
	} else {
		process.env[HOOK] = savedHook;
	}
});

function outDir(name: string): string {
	return mkdtempSync(join(tmpdir(), `judge-${name}-`));
}

describe("judge via stub (offline)", () => {
	test("a passing stub reply yields pass true", async () => {
		const outcome = await runJudge({
			rubric: "The reply explains the redaction.",
			model: "stub/scripted",
			opencodeBin: opencodeBin(),
			evidenceDir: outDir("pass"),
			text: "the key was redacted",
			stubReply: '{"pass":true,"reason":"ok"}',
		});
		expect(outcome.verdict).toEqual({ pass: true, reason: "ok" });
	}, 600_000);

	test("a failing stub reply yields pass false", async () => {
		const outcome = await runJudge({
			rubric: "The reply explains the redaction.",
			model: "stub/scripted",
			opencodeBin: opencodeBin(),
			evidenceDir: outDir("fail"),
			text: "nothing was redacted",
			stubReply: '{"pass":false,"reason":"no redaction shown"}',
		});
		expect(outcome.verdict).toEqual({
			pass: false,
			reason: "no redaction shown",
		});
	}, 600_000);

	test("a non-JSON stub reply is a failed judgement", async () => {
		const outcome = await runJudge({
			rubric: "R.",
			model: "stub/scripted",
			opencodeBin: opencodeBin(),
			evidenceDir: outDir("invalid"),
			stubReply: "looks good to me",
		});
		expect(outcome.verdict.pass).toBe(false);
		expect(outcome.verdict.reason).toMatch(/^judge reply was not valid JSON: /);
	}, 600_000);
});
