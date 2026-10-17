import { describe, expect, test } from "bun:test";
import {
	parseLogLine,
	parseLogs,
	pluginLogProblems,
} from "../../src/opencode/logs.ts";

// Exact real lines from opencode 2.0.26 (IMPLEMENTATION_PROMPT M3).
const FAILED_LOAD =
	'timestamp=2026-10-17T22:02:15.624Z level=WARN run=58f085ac message="failed to load plugin" plugin.id=spike-boom cause="Cause([Die(Error: BOOM in setup)])" http.span=439 role=server';
const LOADING =
	'timestamp=2026-10-17T22:02:15.313Z level=INFO run=58f085ac msg="loading plugin" id=/tmp/claude-0/spike/plugins/a entrypoint=file:///tmp/claude-0/spike/plugins/a/server.ts http.span=128 role=server';
const NOT_A_DIR =
	'timestamp=2026-10-17T21:59:00.449Z level=WARN run=b3b4beed message="configured plugin path must be a directory" target=/tmp/claude-0/spike/plugins/a.ts http.span=85 role=server';

describe("parseLogLine", () => {
	test("parses bare values, quoted values, and dotted keys", () => {
		const parsed = parseLogLine(FAILED_LOAD);
		expect(parsed).toEqual({
			timestamp: "2026-10-17T22:02:15.624Z",
			level: "WARN",
			run: "58f085ac",
			message: "failed to load plugin",
			"plugin.id": "spike-boom",
			cause: "Cause([Die(Error: BOOM in setup)])",
			"http.span": "439",
			role: "server",
		});
	});

	test("handles msg= instead of message=", () => {
		const parsed = parseLogLine(LOADING);
		expect(parsed?.["msg"]).toBe("loading plugin");
		expect(parsed?.["id"]).toBe("/tmp/claude-0/spike/plugins/a");
		expect(parsed?.["entrypoint"]).toBe(
			"file:///tmp/claude-0/spike/plugins/a/server.ts",
		);
		expect(parsed?.["level"]).toBe("INFO");
	});

	test("parses a path target with slashes and dots", () => {
		const parsed = parseLogLine(NOT_A_DIR);
		expect(parsed?.["message"]).toBe(
			"configured plugin path must be a directory",
		);
		expect(parsed?.["target"]).toBe("/tmp/claude-0/spike/plugins/a.ts");
	});

	test("unescapes quoted quotes", () => {
		const parsed = parseLogLine('level=INFO message="say \\"hi\\""');
		expect(parsed?.["message"]).toBe('say "hi"');
	});

	test("returns undefined for empty lines", () => {
		expect(parseLogLine("")).toBeUndefined();
		expect(parseLogLine("   ")).toBeUndefined();
	});
});

describe("parseLogs", () => {
	test("parses lines and keeps the raw line as _raw", () => {
		const lines = parseLogs(`${FAILED_LOAD}\n\n${LOADING}\n`);
		expect(lines).toHaveLength(2);
		expect(lines[0]?._raw).toBe(FAILED_LOAD);
		expect(lines[0]?.["plugin.id"]).toBe("spike-boom");
		expect(lines[1]?._raw).toBe(LOADING);
	});
});

describe("pluginLogProblems", () => {
	test("flags failed-to-load-plugin for the matching id despite WARN level", () => {
		const lines = parseLogs(`${FAILED_LOAD}\n${LOADING}\n${NOT_A_DIR}\n`);
		const problems = pluginLogProblems(lines, { id: "spike-boom" });
		expect(problems).toHaveLength(1);
		expect(problems[0]?._raw).toBe(FAILED_LOAD);
	});

	test("does not flag other plugins", () => {
		const lines = parseLogs(`${FAILED_LOAD}\n${LOADING}\n`);
		expect(pluginLogProblems(lines, { id: "other-plugin" })).toHaveLength(0);
	});

	test("flags ERROR lines naming the plugin path", () => {
		const raw =
			'timestamp=2026-10-17T22:02:15.624Z level=ERROR run=abc message="boom" target=/tmp/x/my-plugin/server.ts';
		const lines = parseLogs(`${raw}\n${LOADING}\n`);
		const problems = pluginLogProblems(lines, {
			id: "my-plugin",
			path: "/tmp/x/my-plugin",
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]?._raw).toBe(raw);
	});

	test("flags FATAL lines naming the plugin id", () => {
		const raw =
			'timestamp=2026-10-17T22:02:15.624Z level=FATAL run=abc message="died" plugin=my-plugin';
		const lines = parseLogs(raw);
		const problems = pluginLogProblems(lines, { id: "my-plugin" });
		expect(problems).toHaveLength(1);
	});

	test("ignores unrelated ERROR lines", () => {
		const raw =
			'timestamp=2026-10-17T22:02:15.624Z level=ERROR run=abc message="Failed to fetch models.dev"';
		const lines = parseLogs(raw);
		expect(
			pluginLogProblems(lines, { id: "my-plugin", path: "/tmp/x/my-plugin" }),
		).toHaveLength(0);
	});
});
