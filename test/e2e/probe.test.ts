// M5 acceptance: with [pre, fixture-a, post] loaded, `pre` records the
// original hook inputs, `post` records the fixture's mutations, the
// inventory lists the fixture, and session events are captured.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readProbe } from "../../src/probe/read.ts";
import { Sandbox } from "../../src/sandbox/sandbox.ts";
import { type Stub, startStub } from "../../src/stub/stub.ts";

// Inline temp fixture (M5 predates the M6 fixture set): adds echo_tool,
// appends "+A" to its input in execute.before, and injects SPIKE_A=1 into
// every shell creation. Written as server.ts so opencode loads it directly.
const PLUGIN_SERVER = `export default {
  id: "fixture-probe-a",
  setup: async (ctx) => {
    await ctx.tool.transform((editor) => {
      // Transforms are re-run on reloads: only add once.
      if (editor.get("echo_tool")) return;
      editor.add({
        name: "echo_tool",
        description: "Echo the input text back",
        input: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
        execute: async (input) => ({ content: "echo:" + input.text }),
      });
    });
    await ctx.tool.hook("execute.before", (i) => {
      if (i.tool === "echo_tool" && i.input && typeof i.input.text === "string") {
        i.input.text = i.input.text + "+A";
      }
    });
    await ctx.shell.hook("create.before", (i) => {
      if (i.env && typeof i.env === "object") {
        i.env.SPIKE_A = "1";
      } else {
        i.env = { SPIKE_A: "1" };
      }
    });
  },
};
`;

const stubs: Stub[] = [];
const tmpDirs: string[] = [];
afterEach(async () => {
	while (stubs.length > 0) {
		await stubs.pop()?.stop();
	}
	while (tmpDirs.length > 0) {
		const dir = tmpDirs.pop();
		if (dir === undefined) {
			break;
		}
		await rm(dir, { recursive: true, force: true });
	}
});

describe("probe e2e", () => {
	test("pre sees originals, post sees mutations", async () => {
		const opencodeBin =
			process.env.OPENCODE_BIN ??
			resolve(import.meta.dir, "../../review/oc/node_modules/.bin/opencode");

		const preDir = fileURLToPath(new URL("../../probe/pre", import.meta.url));
		const postDir = fileURLToPath(new URL("../../probe/post", import.meta.url));

		const pluginDir = join(
			tmpdir(),
			`opencode-plugin-ci-probea-${process.pid}-${Date.now()}`,
		);
		tmpDirs.push(pluginDir);
		mkdirSync(pluginDir, { recursive: true });
		writeFileSync(
			join(pluginDir, "package.json"),
			JSON.stringify({ name: "fixture-probe-a", type: "module" }),
		);
		writeFileSync(join(pluginDir, "server.ts"), PLUGIN_SERVER);

		const stub = await startStub({
			script: [
				{ toolCalls: [{ name: "echo_tool", arguments: { text: "hi" } }] },
				{
					toolCalls: [
						{
							name: "shell",
							arguments: { command: "echo hi", description: "test" },
						},
					],
				},
				{ text: "done" },
			],
		});
		stubs.push(stub);

		// The probe `out` must be known before construction, so point both
		// probes at a temp file owned by this test.
		const probeFile = join(
			tmpdir(),
			`opencode-plugin-ci-probe-${process.pid}-${Date.now()}.jsonl`,
		);

		const sandbox = new Sandbox({
			opencodeBin,
			stubUrl: stub.url,
			plugins: [
				{ package: preDir, options: { out: probeFile } },
				{ package: pluginDir, options: {} },
				{ package: postDir, options: { out: probeFile } },
			],
		});
		try {
			const run = await sandbox.run("go");
			expect(run.timedOut).toBe(false);
			expect(run.code).toBe(0);

			const log = readProbe(probeFile);
			expect(log.records.length).toBeGreaterThan(0);

			// Tool input mutation: pre sees "hi", post sees "hi+A".
			const preBefore = log
				.byKind("tool.before", "pre")
				.filter((r) => r.tool === "echo_tool");
			const postBefore = log
				.byKind("tool.before", "post")
				.filter((r) => r.tool === "echo_tool");
			expect(preBefore.length).toBeGreaterThan(0);
			expect(postBefore.length).toBeGreaterThan(0);
			expect((preBefore[0]?.input as { text?: string } | undefined)?.text).toBe(
				"hi",
			);
			expect(
				(postBefore[0]?.input as { text?: string } | undefined)?.text,
			).toBe("hi+A");

			// Shell env injection: post has SPIKE_A=1, pre does not.
			const preShell = log.byKind("shell.before", "pre");
			const postShell = log.byKind("shell.before", "post");
			expect(preShell.length).toBeGreaterThan(0);
			expect(postShell.length).toBeGreaterThan(0);
			for (const record of preShell) {
				expect(
					(record.env as Record<string, string> | undefined)?.SPIKE_A,
				).toBeUndefined();
			}
			expect(
				(postShell[0]?.env as Record<string, string> | undefined)?.SPIKE_A,
			).toBe("1");

			// Inventory (post only): fixture active, echo_tool listed.
			expect(log.inventory).toBeDefined();
			const fixture = log.inventory?.plugins.find(
				(p) => p.id === "fixture-probe-a",
			);
			expect(fixture?.status).toBe("active");
			expect(log.inventory?.tools).toContain("echo_tool");

			// Paired tool calls exclude the outer execute wrapper.
			const calls = log.toolCalls("post");
			expect(calls.some((c) => c.tool === "echo_tool")).toBe(true);
			expect(calls.some((c) => c.tool === "execute")).toBe(false);
			expect(calls.some((c) => c.tool === "shell")).toBe(true);

			// At least one captured session event.
			const events = log.byKind("event", "post");
			expect(events.some((e) => e.type === "session.tool.called")).toBe(true);
		} finally {
			await sandbox.dispose();
			await rm(probeFile, { force: true });
		}
	}, 300_000);
});
