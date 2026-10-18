// M4 acceptance: a Code Mode fixture tool called by its bare scripted name
// is auto-wrapped through `execute` and completes with the tool's output.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { toolUses } from "../../src/opencode/events.ts";
import { Sandbox } from "../../src/sandbox/sandbox.ts";
import { type Stub, startStub } from "../../src/stub/stub.ts";

const PLUGIN_SERVER = `export default {
  id: "fixture-echo",
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

describe("stub codemode e2e", () => {
	test("bare echo_tool call completes via execute", async () => {
		const opencodeBin =
			process.env.OPENCODE_BIN ??
			resolve(import.meta.dir, "../../review/oc/node_modules/.bin/opencode");

		const pluginDir = join(
			tmpdir(),
			`opencode-plugin-ci-echo-${process.pid}-${Date.now()}`,
		);
		tmpDirs.push(pluginDir);
		mkdirSync(pluginDir, { recursive: true });
		writeFileSync(
			join(pluginDir, "package.json"),
			JSON.stringify({ name: "fixture-echo", type: "module" }),
		);
		writeFileSync(join(pluginDir, "server.ts"), PLUGIN_SERVER);

		const stub = await startStub({
			script: [
				{ toolCalls: [{ name: "echo_tool", arguments: { text: "hi" } }] },
				{ text: "done" },
			],
		});
		stubs.push(stub);

		const sandbox = new Sandbox({
			opencodeBin,
			stubUrl: stub.url,
			plugins: [{ package: pluginDir }],
		});
		try {
			const run = await sandbox.run("go");
			expect(run.timedOut).toBe(false);
			expect(run.code).toBe(0);

			const uses = toolUses(run.events);
			const execute = uses.filter((u) => u.tool === "execute");
			expect(execute.length).toBeGreaterThan(0);
			const completed = execute.filter((u) => u.status === "completed");
			expect(completed.length).toBeGreaterThan(0);
			expect(
				completed.some((u) => String(u.output ?? "").includes("echo:hi")),
			).toBe(true);

			// The scripted bare call was wrapped to execute by the stub.
			const sent = stub.primary()[0]?.sent?.toolCalls?.[0];
			expect(sent?.name).toBe("execute");
			expect(String(sent?.arguments?.code ?? "")).toContain("tools.echo_tool");
		} finally {
			await sandbox.dispose();
		}
	}, 300_000);
});
