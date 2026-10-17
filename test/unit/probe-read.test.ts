// Unit tests for the probe log reader: defensive parsing, pairing, and
// the outer-execute exclusion.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProbeLog, readProbe } from "../../src/probe/read.ts";

function writeProbe(lines: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), "opencode-plugin-ci-probe-"));
	const file = join(dir, "probe.jsonl");
	writeFileSync(file, lines.join("\n"));
	return file;
}

describe("readProbe", () => {
	test("skips bad lines and keeps good records", () => {
		const file = writeProbe([
			`{"kind":"setup","phase":"pre","seq":0}`,
			`not json at all`,
			``,
			`{"kind":"tool.before","phase":"post","seq":1,"tool":"shell"}`,
			`{"kind":`,
		]);
		const log = readProbe(file);
		expect(log.records).toHaveLength(2);
		expect(log.byKind("setup")).toHaveLength(1);
		expect(log.byKind("tool.before", "post")).toHaveLength(1);
		expect(log.byKind("tool.before", "pre")).toHaveLength(0);
	});

	test("missing file yields an empty log", () => {
		const log = readProbe("/nonexistent/probe.jsonl");
		expect(log.records).toHaveLength(0);
		expect(log.inventory).toBeUndefined();
		expect(log.toolCalls()).toHaveLength(0);
	});

	test("extracts the inventory record", () => {
		const file = writeProbe([
			`{"kind":"inventory","phase":"post","seq":5,"plugins":[{"id":"a","status":"active"}],"tools":["echo_tool"],"commands":[],"agents":[],"skills":[],"mcp":[]}`,
		]);
		const log = readProbe(file);
		expect(log.inventory?.tools).toEqual(["echo_tool"]);
		expect(log.inventory?.plugins).toHaveLength(1);
	});

	test("toolCalls pairs by callID and drops outer execute with inner calls", () => {
		const log = new ProbeLog([
			{
				kind: "tool.before",
				phase: "post",
				seq: 1,
				tool: "execute",
				callID: "outer",
				input: { code: "return await tools.echo_tool({text:1})" },
			},
			{
				kind: "tool.before",
				phase: "post",
				seq: 2,
				tool: "echo_tool",
				callID: "inner",
				input: { text: "hi" },
			},
			{
				kind: "tool.after",
				phase: "post",
				seq: 3,
				tool: "echo_tool",
				callID: "inner",
				status: "completed",
				result: { content: "echo:hi" },
			},
			{
				kind: "tool.after",
				phase: "post",
				seq: 4,
				tool: "execute",
				callID: "outer",
				status: "completed",
				result: {
					metadata: { metadata: { toolCalls: [{ tool: "echo_tool" }] } },
				},
			},
			{
				kind: "tool.before",
				phase: "post",
				seq: 5,
				tool: "execute",
				callID: "bare",
				input: { code: "1+1" },
			},
			{
				kind: "tool.after",
				phase: "post",
				seq: 6,
				tool: "execute",
				callID: "bare",
				status: "completed",
				result: { content: "2" },
			},
		]);
		const calls = log.toolCalls("post");
		expect(calls.map((c) => c.tool)).toEqual(["echo_tool", "execute"]);
		expect(calls[0]?.input).toEqual({ text: "hi" });
		expect(calls[0]?.status).toBe("completed");
	});
});
