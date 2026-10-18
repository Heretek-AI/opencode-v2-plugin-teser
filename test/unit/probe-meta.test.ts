// OCI-3.3-meta: probe metadata-last ordering. `writeRecord` spreads metadata
// LAST (`{ ...payload, phase, seq, t, kind }`), so a payload field can never
// overwrite `kind`/`phase`. This test writes a record whose data contains
// colliding `kind`/`phase`/`seq` and asserts the parsed line keeps the
// metadata values. A payload-wins sabotage (`{ phase, seq, t, kind,
// ...payload }`) goes red here.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error: probe/core.js is intentionally untyped JS (excluded
// from tsconfig: TS7016); this test pins its runtime record framing.
import { makeProbe, writeRecord } from "../../probe/core.js";
import { cleanupTempDirs, tempDir } from "../helpers/tmp.ts";

afterAll(cleanupTempDirs);

function outFile(): string {
	return join(tempDir("probe-meta-"), "probe.jsonl");
}

function parsed(out: string): Record<string, unknown>[] {
	return readFileSync(out, "utf8")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("probe metadata-last", () => {
	test("colliding payload keys never overwrite kind/phase/seq", () => {
		const out = outFile();
		writeRecord(
			out,
			"tool.before",
			{ tool: "shell", kind: "forged", phase: "forged", seq: 999, t: 1 },
			"pre",
			7,
		);
		const [record] = parsed(out);
		expect(record?.kind).toBe("tool.before");
		expect(record?.phase).toBe("pre");
		expect(record?.seq).toBe(7);
		expect(typeof record?.t).toBe("number");
		expect(record?.t).not.toBe(1);
		// The payload itself survives, nested under its own keys.
		expect(record?.tool).toBe("shell");
	});

	test("makeProbe lines carry metadata from the probe, not the payload", async () => {
		const out = outFile();
		const handlers = new Map<string, (input: unknown) => unknown>();
		const ctx = {
			options: { out },
			tool: {
				hook: async (name: string, fn: (input: unknown) => unknown) => {
					handlers.set(`tool.${name}`, fn);
				},
			},
			shell: {
				hook: async (name: string, fn: (input: unknown) => unknown) => {
					handlers.set(`shell.${name}`, fn);
				},
			},
			session: {
				hook: async (name: string, fn: (input: unknown) => unknown) => {
					handlers.set(`session.${name}`, fn);
				},
			},
			event: { subscribe: () => (async function* () {})() },
			plugin: { list: async () => [] },
		};
		await makeProbe("pre").setup(ctx);
		const before = handlers.get("tool.execute.before");
		await before?.({
			tool: "shell",
			id: "c1",
			input: { command: "echo hi", kind: "forged", seq: 999 },
		});
		const [record] = parsed(out).filter((r) => r.kind === "tool.before");
		expect(record?.phase).toBe("pre");
		expect(record?.seq).toBe(1);
		expect(record?.kind).toBe("tool.before");
	});
});
