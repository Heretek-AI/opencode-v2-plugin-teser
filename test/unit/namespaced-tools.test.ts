// Review S5: hooks record a namespaced tool as <namespace>_<name>, while
// catalogs use tools.ns.name and inner calls ns.name. Assertions accept all
// three spellings, and a bare name fails with a hint.
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { evaluate, normalizeToolName } from "../../src/assert/expect.ts";
import { ScenarioSchema } from "../../src/config/schema.ts";
import { ProbeLog, type ProbeRecord } from "../../src/probe/read.ts";

describe("namespaced tool names", () => {
	test("normalizeToolName maps every spelling to the effective name", () => {
		expect(normalizeToolName("ns_spike_echo")).toBe("ns_spike_echo");
		expect(normalizeToolName("ns.spike_echo")).toBe("ns_spike_echo");
		expect(normalizeToolName("tools.ns.spike_echo")).toBe("ns_spike_echo");
		expect(normalizeToolName('tools.ns["my-tool"]')).toBe("ns_my-tool");
		expect(normalizeToolName("echo_tool")).toBe("echo_tool");
	});

	function evidence(tool: string) {
		const records: ProbeRecord[] = [
			{
				kind: "tool.before",
				phase: "post",
				seq: 0,
				tool,
				callID: "c1",
				input: { text: "hi" },
			},
			{
				kind: "tool.after",
				phase: "post",
				seq: 1,
				tool,
				callID: "c1",
				status: "completed",
				result: { content: "echo:hi" },
			},
		];
		return {
			run: {
				code: 0,
				timedOut: false,
				stdout: "",
				stderr: "",
				events: [],
				durationMs: 0,
			},
			probe: new ProbeLog(records),
			stubRequests: [],
			projectDir: tmpdir(),
			mode: "scripted" as const,
		};
	}

	function expectBlock(block: unknown) {
		return ScenarioSchema.parse({
			id: "ns",
			mode: "scripted",
			prompt: "hi",
			script: [],
			expect: block,
		}).expect;
	}

	test("the dotted catalog form matches the recorded effective name", () => {
		const failures = evaluate(
			expectBlock({ tools: [{ name: "ns.spike_echo", status: "completed" }] }),
			evidence("ns_spike_echo"),
		);
		expect(failures).toEqual([]);
	});

	test("a bare name fails with a hint naming the namespaced form", () => {
		const failures = evaluate(
			expectBlock({ tools: [{ name: "spike_echo" }] }),
			evidence("ns_spike_echo"),
		);
		expect(failures.join("\n")).toContain("did you mean ns_spike_echo?");
	});

	test("noTools catches the dotted form", () => {
		const failures = evaluate(
			expectBlock({ noTools: ["ns.spike_echo"] }),
			evidence("ns_spike_echo"),
		);
		expect(failures.join("\n")).toContain(
			'expected tool "ns.spike_echo" not to be called',
		);
	});
});
