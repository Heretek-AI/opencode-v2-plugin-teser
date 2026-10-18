// M9: unit tests for evaluate() with fake evidence (no opencode).
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Evidence, evaluate } from "../../src/assert/expect.ts";
import type { ScenarioExpect } from "../../src/config/schema.ts";
import type { RunEvent } from "../../src/opencode/events.ts";
import { ProbeLog } from "../../src/probe/read.ts";
import type { RunOutput } from "../../src/sandbox/sandbox.ts";
import type { Recorded } from "../../src/stub/stub.ts";

function run(overrides: Partial<RunOutput> = {}): RunOutput {
	return {
		code: 0,
		timedOut: false,
		stdout: "",
		stderr: "",
		events: [],
		durationMs: 1,
		...overrides,
	};
}

function textEvent(text: string): RunEvent {
	return { type: "text", part: { type: "text", text } };
}

function toolUseEvent(
	tool: string,
	status: string,
	input: unknown,
	output: unknown,
): RunEvent {
	return {
		type: "tool_use",
		part: { type: "tool", tool, state: { status, input, output } },
	};
}

/** A paired tool.before/tool.after probe log for one completed call. */
function probeWithToolCall(
	tool: string,
	input: unknown,
	result: unknown,
	status = "completed",
): ProbeLog {
	return new ProbeLog([
		{
			kind: "tool.before",
			phase: "post",
			seq: 0,
			tool,
			callID: "c1",
			input,
		},
		{
			kind: "tool.after",
			phase: "post",
			seq: 1,
			tool,
			callID: "c1",
			status,
			input,
			result,
		},
	]);
}

function primaryRequest(body: unknown): Recorded {
	return { seq: 0, kind: "primary", body };
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
	return {
		run: run(),
		probe: new ProbeLog([]),
		stubRequests: [],
		projectDir: mkdtempSync(join(tmpdir(), "expect-")),
		mode: "scripted",
		...overrides,
	};
}

const OK: ScenarioExpect = { exitCode: 0, noErrors: true };

describe("evaluate exitCode/noErrors", () => {
	test("non-zero exit code fails", () => {
		const failures = evaluate(OK, evidence({ run: run({ code: 1 }) }));
		expect(failures.join("\n")).toContain("expected exit code 0, got 1");
	});

	test("error events fail when noErrors", () => {
		const ev = evidence({
			run: run({
				events: [{ type: "error", error: { message: "boom" } }],
			}),
		});
		expect(evaluate(OK, ev).join("\n")).toContain("error event");
	});
});

describe("evaluate tools", () => {
	test("matching call passes", () => {
		const ev = evidence({
			probe: probeWithToolCall(
				"echo_tool",
				{ text: "hi" },
				{
					content: "echo:hi",
				},
			),
		});
		const failures = evaluate(
			{
				...OK,
				tools: [
					{
						name: "echo_tool",
						status: "completed",
						input: { text: { equals: "hi" } },
						output: { contains: "echo:hi" },
					},
				],
			},
			ev,
		);
		expect(failures).toEqual([]);
	});

	test("wrong output fails with the specific message", () => {
		const ev = evidence({
			probe: probeWithToolCall(
				"echo_tool",
				{ text: "hi" },
				{
					content: "echo:hi",
				},
			),
		});
		const failures = evaluate(
			{
				...OK,
				tools: [{ name: "echo_tool", output: { contains: "echo:bye" } }],
			},
			ev,
		);
		expect(failures.join("\n")).toContain('expected to contain "echo:bye"');
		expect(failures.join("\n")).toContain("echo:hi");
	});

	test("missing tool fails the default count", () => {
		const failures = evaluate(
			{ ...OK, tools: [{ name: "echo_tool" }] },
			evidence(),
		);
		expect(failures.join("\n")).toContain("expected count >= 1, got 0");
	});

	test("at least one call must match everything together", () => {
		const probe = new ProbeLog([
			{
				kind: "tool.before",
				phase: "post",
				seq: 0,
				tool: "t",
				callID: "a",
				input: { x: "1" },
			},
			{
				kind: "tool.after",
				phase: "post",
				seq: 1,
				tool: "t",
				callID: "a",
				status: "completed",
				input: { x: "1" },
				result: { content: "one" },
			},
			{
				kind: "tool.before",
				phase: "post",
				seq: 2,
				tool: "t",
				callID: "b",
				input: { x: "2" },
			},
			{
				kind: "tool.after",
				phase: "post",
				seq: 3,
				tool: "t",
				callID: "b",
				status: "completed",
				input: { x: "2" },
				result: { content: "two" },
			},
		]);
		const failures = evaluate(
			{
				...OK,
				tools: [
					{
						name: "t",
						input: { x: { equals: "1" } },
						output: { contains: "two" },
					},
				],
			},
			evidence({ probe }),
		);
		expect(failures.join("\n")).toContain("none matched");
	});

	test("noTools fails when the tool was called", () => {
		const ev = evidence({
			probe: probeWithToolCall("webfetch", {}, { content: "x" }),
		});
		const failures = evaluate({ ...OK, noTools: ["webfetch"] }, ev);
		expect(failures.join("\n")).toContain("not to be called");
	});

	test("noTools sees event-level tool uses", () => {
		const ev = evidence({
			run: run({ events: [toolUseEvent("webfetch", "completed", {}, "x")] }),
		});
		const failures = evaluate({ ...OK, noTools: ["webfetch"] }, ev);
		expect(failures).toHaveLength(1);
	});
});

describe("evaluate hooks", () => {
	function shellProbe(): ProbeLog {
		return new ProbeLog([
			{
				kind: "shell.before",
				phase: "post",
				seq: 0,
				command: "echo [x]",
				env: { FIXTURE_ON: "1" },
			},
		]);
	}

	test("shell env matcher passes", () => {
		const failures = evaluate(
			{
				...OK,
				hooks: [
					{
						hook: "shell.create.before",
						phase: "post",
						env: { FIXTURE_ON: { equals: "1" } },
					},
				],
			},
			evidence({ probe: shellProbe() }),
		);
		expect(failures).toEqual([]);
	});

	test("missing hook record fails", () => {
		const failures = evaluate(
			{
				...OK,
				hooks: [{ hook: "shell.create.before", phase: "pre" }],
			},
			evidence({ probe: shellProbe() }),
		);
		expect(failures.join("\n")).toContain("got none");
	});

	test("session.context system matcher joins parts", () => {
		const probe = new ProbeLog([
			{
				kind: "session.context",
				phase: "post",
				seq: 0,
				system: ["base prompt", "FIXTURE-SYSTEM"],
				tools: [],
			},
		]);
		const pass = evaluate(
			{
				...OK,
				hooks: [
					{
						hook: "session.context",
						phase: "post",
						system: { contains: "FIXTURE-SYSTEM" },
					},
				],
			},
			evidence({ probe }),
		);
		expect(pass).toEqual([]);
		const fail = evaluate(
			{
				...OK,
				hooks: [
					{
						hook: "session.context",
						phase: "post",
						system: { contains: "MISSING" },
					},
				],
			},
			evidence({ probe }),
		);
		expect(fail.join("\n")).toContain("no record matched");
	});
});

describe("evaluate request", () => {
	const body = {
		messages: [
			{ role: "system", content: "base\nFIXTURE-SYSTEM" },
			{ role: "user", content: "hi" },
		],
		tools: [{ type: "function", function: { name: "execute" } }],
	};

	test("system contains passes, tools catalog names resolve", () => {
		const catalogBody = {
			messages: [
				{
					role: "system",
					content:
						"- spike_echo (1 tool)\n  - tools.spike_echo({\n  text: string,\n}): Promise<string>",
				},
			],
			tools: [{ type: "function", function: { name: "execute" } }],
		};
		const failures = evaluate(
			{
				...OK,
				request: {
					nth: 1,
					system: { contains: "FIXTURE-SYSTEM" },
					tools: { includes: ["spike_echo"] },
				},
			},
			evidence({
				stubRequests: [
					primaryRequest({
						messages: [
							...body.messages,
							{
								role: "system",
								content: (catalogBody.messages[0] as { content: string })
									.content,
							},
						],
						tools: catalogBody.tools,
					}),
				],
			}),
		);
		expect(failures).toEqual([]);
	});

	test("missing nth request fails", () => {
		const failures = evaluate(
			{ ...OK, request: { nth: 2 } },
			evidence({ stubRequests: [primaryRequest(body)] }),
		);
		expect(failures.join("\n")).toContain(
			"expected at least 2 primary request(s), got 1",
		);
	});
});

describe("evaluate files", () => {
	test("exists true/false and contains", () => {
		const dir = mkdtempSync(join(tmpdir(), "expect-files-"));
		mkdirSync(join(dir, ".fixture"), { recursive: true });
		writeFileSync(join(dir, ".fixture", "events.log"), "called\n");
		const ev = evidence({ projectDir: dir });
		expect(
			evaluate(
				{
					...OK,
					files: [
						{ path: ".fixture/events.log", exists: true, contains: "called" },
					],
				},
				ev,
			),
		).toEqual([]);
		const fail = evaluate(
			{
				...OK,
				files: [{ path: ".fixture/nope.log", exists: true }],
			},
			ev,
		);
		expect(fail.join("\n")).toContain("expected file to exist");
	});

	test("escaping paths are rejected", () => {
		const failures = evaluate(
			{ ...OK, files: [{ path: "../escape.log", exists: true }] },
			evidence(),
		);
		expect(failures.join("\n")).toContain("escapes the project dir");
	});
});

describe("evaluate text and stderr", () => {
	test("text joins text events, stderr is raw", () => {
		const ev = evidence({
			run: run({
				events: [textEvent("hello"), textEvent("world")],
				stderr: "level=WARN oops",
			}),
		});
		expect(evaluate({ ...OK, text: { contains: "hello\nworld" } }, ev)).toEqual(
			[],
		);
		expect(
			evaluate({ ...OK, stderr: { notMatches: "(?i)oops" } }, ev),
		).toHaveLength(1);
	});
});
