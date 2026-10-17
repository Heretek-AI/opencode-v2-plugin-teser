// Unit snapshot-check of the Markdown report for a fixed ResultsFile:
// one required pass, one required failure, one allowed failure, one skip,
// and a live row so cost/token totals render.
import { describe, expect, test } from "bun:test";
import {
	deriveAllowedVersions,
	renderMarkdown,
} from "../../src/report/markdown.ts";
import type { ResultsFile } from "../../src/report/results.ts";

const FIXED: ResultsFile = {
	version: 1,
	at: "2026-10-17T00:00:00.000Z",
	tool: "0.1.0",
	plugin: "fixture-tool-basic",
	results: [
		{
			id: "load",
			tier: "load",
			opencode: "2.0.26",
			pass: true,
			tools: ["echo_tool"],
			steps: 1,
			costUSD: 0,
			tokens: { input: 10, output: 5 },
			durationMs: 1500,
			textExcerpt: "ok",
			kept: ".opencode-ci/out/2.0.26/load",
		},
		{
			id: "tool-basic-pass",
			tier: "scripted",
			opencode: "2.0.26",
			pass: true,
			description: "echo_tool is called and returns echo:hi",
			tools: ["echo_tool", "shell"],
			steps: 2,
			durationMs: 23400,
			textExcerpt: "done",
			kept: ".opencode-ci/out/2.0.26/tool-basic-pass",
		},
		{
			id: "tool-basic-fail",
			tier: "scripted",
			opencode: "2.0.26",
			pass: false,
			failures: [
				'tools[0].output: expected to contain "echo:bye", got "echo:hi"',
			],
			tools: ["echo_tool"],
			steps: 2,
			durationMs: 22100,
			textExcerpt: "done",
			kept: ".opencode-ci/out/2.0.26/tool-basic-fail",
		},
		{
			id: "tool-basic-fail",
			tier: "scripted",
			opencode: "latest",
			pass: false,
			failures: ["opencode exited with code 1."],
			durationMs: 5000,
			textExcerpt: "",
			kept: ".opencode-ci/out/latest/tool-basic-fail",
		},
		{
			id: "future-live",
			tier: "live",
			opencode: "2.0.26",
			pass: true,
			skipped: "live tier not implemented (M11)",
			description: "placeholder live scenario",
			durationMs: 0,
		},
		{
			id: "live-real",
			tier: "live",
			opencode: "2.0.26",
			pass: true,
			costUSD: 0.0123,
			tokens: { input: 1000, output: 200 },
			steps: 3,
			durationMs: 60000,
			textExcerpt: "the tool output shows echo:hi",
			kept: ".opencode-ci/out/2.0.26/live-real",
		},
	],
};

describe("renderMarkdown", () => {
	test("renders header, tables, failures and live totals", () => {
		const md = renderMarkdown(FIXED, {
			allowedVersions: ["latest"],
			sha: "abc1234",
		});
		// Header.
		expect(md).toContain("# opencode-plugin-ci report");
		expect(md).toContain("plugin: fixture-tool-basic");
		expect(md).toContain("tool: 0.1.0");
		expect(md).toContain("opencode: 2.0.26, latest");
		expect(md).toContain("sha: abc1234");
		expect(md).toContain("**Totals:** 3 passed, 2 failed, 1 skipped");
		// One table per opencode version.
		expect(md).toContain("## opencode 2.0.26 (required)");
		expect(md).toContain("## opencode latest (allowed to fail)");
		expect(md).toContain(
			"| Tier | Case | Result | Tools | Steps | Cost | Time |",
		);
		// Result cells.
		expect(md).toContain("✅ pass");
		expect(md).toContain("❌ fail");
		expect(md).toContain("⚠️ allowed failure");
		expect(md).toContain("⏭️ skipped (live tier not implemented (M11))");
		// Failure details with evidence path.
		expect(md).toContain("<details>");
		expect(md).toContain('expected to contain "echo:bye"');
		expect(md).toContain("Evidence: `.opencode-ci/out/2.0.26/tool-basic-fail`");
		// Live totals line.
		expect(md).toContain("Live totals: $0.0123");
		expect(md).toContain("1000 input / 200 output tokens");
	});

	test("matches snapshot", () => {
		const md = renderMarkdown(FIXED, {
			allowedVersions: ["latest"],
			sha: "abc1234",
		});
		expect(md).toMatchSnapshot();
	});

	test("deriveAllowedVersions mirrors run.ts versions.slice(1)", () => {
		expect(deriveAllowedVersions(FIXED)).toEqual(["latest"]);
		expect(
			deriveAllowedVersions({
				version: 1,
				at: "2026-10-17T00:00:00.000Z",
				tool: "0.1.0",
				plugin: "p",
				results: [],
			}),
		).toEqual([]);
	});

	test("report path derivation renders allowed failure for non-first version", () => {
		// Same derivation cmdReport uses: unique opencode values slice(1).
		const allowedVersions = deriveAllowedVersions(FIXED);
		const md = renderMarkdown(FIXED, {
			allowedVersions,
			sha: "abc1234",
		});
		// Non-first version (latest) failure is allowed …
		expect(md).toContain("## opencode latest (allowed to fail)");
		expect(md).toContain("⚠️ allowed failure");
		// … while the required (first) version failure stays hard.
		expect(md).toContain("## opencode 2.0.26 (required)");
		expect(md).toContain("❌ fail");
	});
});
