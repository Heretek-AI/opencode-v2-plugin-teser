// M3 acceptance: a Sandbox with no plugins and a stub script [{text:"ok"}]
// exits 0, prints "ok", and raises no error events.
// The stub below inlines the proven SSE respond shape from review/spike/stub-llm.ts.
import { afterEach, describe, expect, test } from "bun:test";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { join, resolve } from "node:path";
import { errors, textOf } from "../../src/opencode/events.ts";
import { Sandbox } from "../../src/sandbox/sandbox.ts";

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolveBody, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

function sseChunk(payload: unknown): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

function respondSSE(
	res: ServerResponse,
	body: Record<string, unknown>,
	text: string,
): void {
	const id = `chatcmpl-stub-${Date.now()}`;
	const base = {
		id,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: (body["model"] as string) ?? "scripted",
	};
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	res.write(
		sseChunk({
			...base,
			choices: [
				{
					index: 0,
					delta: { role: "assistant", content: text },
					finish_reason: null,
				},
			],
		}),
	);
	res.write(
		sseChunk({
			...base,
			choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
		}),
	);
	res.end("data: [DONE]\n\n");
}

function respondJSON(
	res: ServerResponse,
	body: Record<string, unknown>,
	text: string,
): void {
	res.writeHead(200, { "content-type": "application/json" });
	res.end(
		JSON.stringify({
			id: `chatcmpl-stub-${Date.now()}`,
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model: body["model"] ?? "scripted",
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: text },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		}),
	);
}

interface InlineStub {
	url: string;
	stop(): Promise<void>;
}

async function startInlineStub(): Promise<InlineStub> {
	const server: Server = createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if (
			req.method === "GET" &&
			(url.pathname === "/v1/models" || url.pathname === "/models")
		) {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					object: "list",
					data: [{ id: "scripted", object: "model", created: 0 }],
				}),
			);
			return;
		}
		if (req.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
			res.writeHead(404, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: `not found: ${url.pathname}` }));
			return;
		}
		const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
		const hasTools =
			Array.isArray(body["tools"]) && (body["tools"] as unknown[]).length > 0;
		const text = hasTools ? "ok" : "Stub title";
		if (body["stream"] === true) {
			respondSSE(res, body, text);
		} else {
			respondJSON(res, body, text);
		}
	});
	await new Promise<void>((resolveListen) =>
		server.listen(0, "127.0.0.1", resolveListen),
	);
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("inline stub failed to bind");
	}
	return {
		url: `http://127.0.0.1:${address.port}/v1`,
		stop: () =>
			new Promise<void>((resolveStop, rejectStop) =>
				server.close((e) => (e ? rejectStop(e) : resolveStop())),
			),
	};
}

const stubs: InlineStub[] = [];
afterEach(async () => {
	while (stubs.length > 0) {
		await stubs.pop()?.stop();
	}
});

describe("sandbox e2e", () => {
	test("no plugins + stub ok", async () => {
		const opencodeBin =
			process.env.OPENCODE_BIN ??
			resolve(import.meta.dir, "../../review/oc/node_modules/.bin/opencode");
		const stub = await startInlineStub();
		stubs.push(stub);
		const sandbox = new Sandbox({
			opencodeBin,
			stubUrl: stub.url,
			plugins: [],
		});
		try {
			const run = await sandbox.run("Say ok.");
			expect(run.timedOut).toBe(false);
			expect(run.code).toBe(0);
			expect(textOf(run.events)).toContain("ok");
			expect(errors(run.events)).toHaveLength(0);
		} finally {
			await sandbox.dispose();
		}
	}, 300_000);

	test("workspace files land in the project dir", async () => {
		const opencodeBin =
			process.env.OPENCODE_BIN ??
			resolve(import.meta.dir, "../../review/oc/node_modules/.bin/opencode");
		const stub = await startInlineStub();
		stubs.push(stub);
		const sandbox = new Sandbox({
			opencodeBin,
			stubUrl: stub.url,
			plugins: [],
			workspace: { "sub/dir/note.txt": "hello workspace\n" },
		});
		try {
			expect(
				await Bun.file(join(sandbox.project, "README.md")).text(),
			).toContain("Sandbox project");
			expect(
				await Bun.file(join(sandbox.project, "sub/dir/note.txt")).text(),
			).toBe("hello workspace\n");
			expect(sandbox.probeFile).toBe(join(sandbox.root, "probe.jsonl"));
			const run = await sandbox.run("Say ok.");
			expect(run.code).toBe(0);
		} finally {
			await sandbox.dispose();
		}
	}, 300_000);
});
