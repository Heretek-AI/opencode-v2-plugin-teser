// OpenAI-compatible stub model server: scripted primary steps, judge
// detection, Code Mode auto-wrap, auxiliary title replies.
//
// The SSE/JSON wire shape below (`sseChunk`, `chunkBase`, `respondSSE`,
// `respondJSON`, the /v1/models handler) is ported byte-for-byte from
// review/spike/stub-llm.ts, which is proven to work against opencode 2.0.26
// via @ai-sdk/openai-compatible. Do not "improve" the chunk shapes: opencode
// is strict about the deltas (tool call id + empty arguments first, argument
// bytes second, then finish_reason).

import { appendFileSync } from "node:fs";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { allMessageText, findCatalogPath } from "./codemode.ts";

export interface ToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

// raw: never auto-wrap this step; send the tool calls exactly as scripted.
export interface Step {
	text?: string;
	toolCalls?: ToolCall[];
	raw?: boolean;
}

export type RequestKind = "primary" | "judge" | "auxiliary";

export interface Recorded {
	seq: number;
	kind: RequestKind;
	step?: Step;
	/** The step actually sent, after Code Mode auto-wrap. */
	sent?: Step;
	body: unknown;
}

export interface StubOptions {
	script: Step[];
	judgeReply?: string;
	recordFile?: string;
}

export interface Stub {
	url: string;
	requests: Recorded[];
	primary(): Recorded[];
	waitForPrimary(n: number, timeoutMs?: number): Promise<void>;
	exhausted: boolean;
	stop(): Promise<void>;
}

export const JUDGE_SENTINEL = "OPENCODE_PLUGIN_CI_JUDGE";
export const EXHAUSTED = "STUB_SCRIPT_EXHAUSTED";

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

function sseChunk(payload: unknown): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

function chunkBase(body: Record<string, unknown>, id: string) {
	return {
		id,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: (body.model as string) ?? "scripted",
	};
}

function respondSSE(
	res: ServerResponse,
	body: Record<string, unknown>,
	step: Step,
) {
	const id = `chatcmpl-stub-${Date.now()}`;
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	if (step.toolCalls && step.toolCalls.length > 0) {
		step.toolCalls.forEach((call, index) => {
			const callId = `call_${Date.now()}_${index}`;
			res.write(
				sseChunk({
					...chunkBase(body, id),
					choices: [
						{
							index,
							delta: {
								role: "assistant",
								content: null,
								tool_calls: [
									{
										index,
										id: callId,
										type: "function",
										function: { name: call.name, arguments: "" },
									},
								],
							},
							finish_reason: null,
						},
					],
				}),
			);
			res.write(
				sseChunk({
					...chunkBase(body, id),
					choices: [
						{
							index,
							delta: {
								tool_calls: [
									{
										index,
										function: { arguments: JSON.stringify(call.arguments) },
									},
								],
							},
							finish_reason: null,
						},
					],
				}),
			);
		});
		res.write(
			sseChunk({
				...chunkBase(body, id),
				choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
			}),
		);
	} else {
		const text = step.text ?? "";
		res.write(
			sseChunk({
				...chunkBase(body, id),
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
				...chunkBase(body, id),
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			}),
		);
	}
	res.end("data: [DONE]\n\n");
}

function respondJSON(
	res: ServerResponse,
	body: Record<string, unknown>,
	step: Step,
) {
	const id = `chatcmpl-stub-${Date.now()}`;
	const message: Record<string, unknown> = {
		role: "assistant",
		content: step.text ?? null,
	};
	let finish = "stop";
	if (step.toolCalls && step.toolCalls.length > 0) {
		message.tool_calls = step.toolCalls.map((call, index) => ({
			id: `call_${Date.now()}_${index}`,
			type: "function",
			function: { name: call.name, arguments: JSON.stringify(call.arguments) },
		}));
		finish = "tool_calls";
	}
	res.writeHead(200, { "content-type": "application/json" });
	res.end(
		JSON.stringify({
			id,
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model: body.model ?? "scripted",
			choices: [{ index: 0, message, finish_reason: finish }],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		}),
	);
}

// Names of the function tools the request offers directly.
export function offeredToolNames(body: unknown): string[] {
	const tools = (body as { tools?: unknown } | null | undefined)?.tools;
	if (!Array.isArray(tools)) {
		return [];
	}
	const names: string[] = [];
	for (const tool of tools) {
		const name = (tool as { function?: { name?: unknown } } | null | undefined)
			?.function?.name;
		if (typeof name === "string") {
			names.push(name);
		}
	}
	return names;
}

/**
 * Classify a chat request. Checked in this order: judge (any message text
 * contains the sentinel), primary (non-empty tools array), else auxiliary
 * (titles and the like, which carry no tools).
 */
export function classifyRequest(body: unknown): RequestKind {
	if (allMessageText(body).includes(JUDGE_SENTINEL)) {
		return "judge";
	}
	const tools = (body as { tools?: unknown } | null | undefined)?.tools;
	if (Array.isArray(tools) && tools.length > 0) {
		return "primary";
	}
	return "auxiliary";
}

/**
 * Rewrite a primary step's tool calls for Code Mode: a call naming a tool
 * that is not offered directly is wrapped as
 * `{ name: "execute", arguments: { code: "return await <path>(<args>)" } }`
 * using the exact catalog path from the request's system text. Direct tools,
 * `raw` steps, and calls with no usable catalog path are left unchanged (a
 * wrong direct call fails loudly in opencode, which the assertions catch).
 */
export function wrapStep(step: Step, body: unknown): Step {
	if (step.raw === true || !step.toolCalls || step.toolCalls.length === 0) {
		return step;
	}
	const offered = new Set(offeredToolNames(body));
	if (!offered.has("execute")) {
		return step;
	}
	const catalogText = allMessageText(body);
	const toolCalls = step.toolCalls.map((call) => {
		if (offered.has(call.name)) {
			return call;
		}
		const path = findCatalogPath(catalogText, call.name);
		if (path === undefined) {
			return call;
		}
		return {
			name: "execute",
			arguments: {
				code: `return await ${path}(${JSON.stringify(call.arguments)})`,
			},
		};
	});
	return { ...step, toolCalls };
}

export async function startStub(opts: StubOptions): Promise<Stub> {
	const requests: Recorded[] = [];
	let stepIndex = 0;
	let seq = 0;
	let isExhausted = false;

	const record = (entry: Omit<Recorded, "seq">): void => {
		const full: Recorded = { ...entry, seq: seq++ };
		requests.push(full);
		if (opts.recordFile) {
			try {
				appendFileSync(opts.recordFile, `${JSON.stringify(full)}\n`);
			} catch {
				/* ignore record errors: stub replies must never fail */
			}
		}
	};

	const server: Server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (
				req.method === "GET" &&
				(url.pathname === "/v1/models" || url.pathname === "/models")
			) {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						object: "list",
						data: [
							{ id: "scripted", object: "model", created: 0, owned_by: "stub" },
						],
					}),
				);
				return;
			}
			if (
				req.method !== "POST" ||
				!url.pathname.endsWith("/chat/completions")
			) {
				res.writeHead(404, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: `not found: ${url.pathname}` }));
				return;
			}
			const raw = await readBody(req);
			const body = JSON.parse(raw) as Record<string, unknown>;
			const kind = classifyRequest(body);
			let step: Step;
			let sent: Step | undefined;
			if (kind === "judge") {
				step = {
					text:
						opts.judgeReply ??
						'{"pass":false,"reason":"no judgeReply scripted"}',
				};
				sent = step;
			} else if (kind === "primary") {
				const next = opts.script[stepIndex];
				if (next === undefined) {
					isExhausted = true;
					step = { text: EXHAUSTED };
					sent = step;
				} else {
					stepIndex += 1;
					step = next;
					sent = wrapStep(step, body);
				}
			} else {
				step = { text: "Stub title" };
				sent = step;
			}
			record({ kind, step, sent, body });
			const reply = sent ?? step;
			if (body.stream === true) {
				respondSSE(res, body, reply);
			} else {
				respondJSON(res, body, reply);
			}
		} catch (err) {
			res.writeHead(500, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: String(err) }));
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("stub failed to bind");
	}
	return {
		url: `http://127.0.0.1:${address.port}/v1`,
		requests,
		primary: () => requests.filter((r) => r.kind === "primary"),
		waitForPrimary: (n: number, timeoutMs = 120_000) =>
			new Promise<void>((resolve, reject) => {
				const started = Date.now();
				const timer = setInterval(() => {
					if (requests.filter((r) => r.kind === "primary").length >= n) {
						clearInterval(timer);
						resolve();
					} else if (Date.now() - started > timeoutMs) {
						clearInterval(timer);
						reject(new Error(`timed out waiting for ${n} primary requests`));
					}
				}, 25);
			}),
		get exhausted() {
			return isExhausted;
		},
		stop: () =>
			new Promise<void>((resolve, reject) =>
				server.close((e) => (e ? reject(e) : resolve())),
			),
	};
}
