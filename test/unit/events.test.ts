import { describe, expect, test } from "bun:test";
import {
	errors,
	parseEvents,
	parseEventsCounted,
	textOf,
	toolUses,
	usage,
} from "../../src/opencode/events.ts";

// Representative --format json lines modeled on real opencode 2.0.26 output
// (IMPLEMENTATION_PROMPT section 2.1).
function fixture(): string {
	const lines = [
		JSON.stringify({
			type: "step_start",
			timestamp: "2026-10-17T22:02:15.000Z",
			sessionID: "ses_123",
			part: { type: "step-start" },
		}),
		JSON.stringify({
			type: "tool_use",
			timestamp: "2026-10-17T22:02:16.000Z",
			sessionID: "ses_123",
			part: {
				type: "tool",
				id: "too_1",
				tool: "execute",
				state: {
					status: "completed",
					input: { code: 'return await tools.spike_echo({text:"hi"})' },
					output: "echo:hi+A",
					metadata: {
						metadata: {
							toolCalls: [
								{
									tool: "spike_echo",
									status: "completed",
									input: { text: "hi+A" },
								},
							],
						},
					},
				},
			},
		}),
		JSON.stringify({
			type: "tool_use",
			timestamp: "2026-10-17T22:02:17.000Z",
			sessionID: "ses_123",
			part: {
				type: "tool",
				id: "too_2",
				tool: "spike_echo",
				state: {
					status: "error",
					input: { text: "bye" },
					error: 'No tool named "spike_echo" is currently available',
				},
			},
		}),
		JSON.stringify({
			type: "step_finish",
			timestamp: "2026-10-17T22:02:18.000Z",
			sessionID: "ses_123",
			part: {
				type: "step-finish",
				reason: "stop",
				cost: 0.001,
				tokens: {
					input: 100,
					output: 20,
					reasoning: 0,
					cache: { read: 10, write: 5 },
				},
			},
		}),
		JSON.stringify({
			type: "text",
			timestamp: "2026-10-17T22:02:19.000Z",
			sessionID: "ses_123",
			part: { type: "text", text: "done" },
		}),
		JSON.stringify({
			type: "error",
			timestamp: "2026-10-17T22:02:20.000Z",
			error: { type: "provider", message: "HTTP 403", status: 403 },
		}),
		"this line does not start with a brace",
		'{"type": "broken", oops',
	];
	return lines.join("\n");
}

describe("parseEvents", () => {
	test("keeps JSON lines and skips bad ones", () => {
		const { events, skipped } = parseEventsCounted(fixture());
		expect(events).toHaveLength(6);
		expect(skipped).toBe(1);
		expect(events[0]?.type).toBe("step_start");
	});
});

describe("textOf", () => {
	test("joins text parts with newline", () => {
		const events = parseEvents(fixture());
		expect(textOf(events)).toBe("done");
	});
});

describe("toolUses", () => {
	test("returns tool, status, input, output, error, and innerCalls", () => {
		const uses = toolUses(parseEvents(fixture()));
		expect(uses).toHaveLength(2);
		expect(uses[0]).toEqual({
			tool: "execute",
			status: "completed",
			input: { code: 'return await tools.spike_echo({text:"hi"})' },
			output: "echo:hi+A",
			error: undefined,
			innerCalls: [
				{ tool: "spike_echo", status: "completed", input: { text: "hi+A" } },
			],
		});
		expect(uses[1]?.tool).toBe("spike_echo");
		expect(uses[1]?.status).toBe("error");
		expect(uses[1]?.innerCalls).toEqual([]);
	});
});

describe("errors", () => {
	test("returns only error events", () => {
		const errs = errors(parseEvents(fixture()));
		expect(errs).toHaveLength(1);
		expect(errs[0]?.error?.message).toBe("HTTP 403");
	});
});

describe("usage", () => {
	test("sums cost and tokens over step_finish parts", () => {
		const first = parseEvents(fixture());
		expect(usage(first)).toEqual({ cost: 0.001, input: 100, output: 20 });

		const twoSteps = [
			JSON.stringify({
				type: "x",
				part: {
					type: "step-finish",
					cost: 0.5,
					tokens: { input: 10, output: 5 },
				},
			}),
			JSON.stringify({
				type: "x",
				part: {
					type: "step-finish",
					cost: 1.5,
					tokens: { input: 30, output: 7 },
				},
			}),
			JSON.stringify({ type: "text", part: { type: "text", text: "hi" } }),
		].join("\n");
		expect(usage(parseEvents(twoSteps))).toEqual({
			cost: 2,
			input: 40,
			output: 12,
		});
	});
});
