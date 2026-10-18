// OCI-1.4-cap: the probe's 200-item array cap truncated tier-1 inventory
// lists, so a tool union over 200 entries failed tier 1 on clipping rather
// than on the plugin. Inventory records bypass the array cap (strings are
// still clipped). This test drives `makeProbe` with a 201-tool inventory and
// asserts every entry — including the last — survives to `probe.jsonl`.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error: probe/core.js is intentionally untyped JS (excluded
// from tsconfig: TS7016); this test pins its runtime inventory framing.
import { makeProbe } from "../../probe/core.js";
import { readProbe } from "../../src/probe/read.ts";
import { cleanupTempDirs, tempDir } from "../helpers/tmp.ts";

afterAll(cleanupTempDirs);

type Handler = (input: Record<string, unknown>) => unknown;

async function inventoryWithTools(tools: string[]): Promise<string> {
	const dir = tempDir("probe-cap-");
	const out = join(dir, "probe.jsonl");
	const handlers = new Map<string, Handler>();
	const ctx = {
		options: { out },
		tool: {
			hook: async (name: string, fn: Handler) => {
				handlers.set(`tool.${name}`, fn);
			},
			list: async () => tools.map((id) => ({ id })),
		},
		shell: {
			hook: async (name: string, fn: Handler) => {
				handlers.set(`shell.${name}`, fn);
			},
		},
		session: {
			hook: async (name: string, fn: Handler) => {
				handlers.set(`session.${name}`, fn);
			},
		},
		event: { subscribe: () => (async function* () {})() },
		plugin: { list: async () => [] },
		command: { list: async () => [] },
		agent: { list: async () => [] },
		skill: { list: async () => [] },
		mcp: { list: async () => [] },
	};
	await makeProbe("post").setup(ctx);
	await handlers.get("session.prompt")?.({ prompt: "hi" });
	return out;
}

describe("probe inventory cap bypass", () => {
	test("a 201-tool inventory keeps every tool, including the last", async () => {
		const tools = Array.from({ length: 200 }, (_, i) => `tool_${i}`);
		tools.push("echo_tool");
		const out = await inventoryWithTools(tools);
		const probe = readProbe(out);
		expect(probe.inventory?.tools).toHaveLength(201);
		expect(probe.inventory?.tools).toContain("echo_tool");
		expect(probe.inventory?.tools?.[200]).toBe("echo_tool");
	});

	test("long strings are still clipped inside inventory records", async () => {
		const out = await inventoryWithTools([`x`.repeat(5000)]);
		const lines = readFileSync(out, "utf8").split("\n").filter(Boolean);
		const inventory = lines
			.map((line) => JSON.parse(line) as { kind?: string })
			.find((record) => record.kind === "inventory");
		expect(JSON.stringify(inventory)).toContain("…[+");
	});
});
