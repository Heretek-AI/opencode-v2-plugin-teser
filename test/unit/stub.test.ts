// M4: stub classification, auto-wrap, recording and exhaustion.
import { afterEach, describe, expect, test } from "bun:test";
import {
	classifyRequest,
	EXHAUSTED,
	JUDGE_SENTINEL,
	offeredToolNames,
	type Stub,
	startStub,
	wrapStep,
} from "../../src/stub/stub.ts";

const CATALOG_BODY = {
	messages: [
		{
			role: "system",
			content: `- opencode (2 tools)
  - tools.opencode.session_move({
  directory: string,
}): Promise<void>
  - tools.opencode.session_rename({
  title: string,
}): Promise<void>
- spike_echo (1 tool)
  - tools.spike_echo({
  text: string,
}): Promise<string | null> // Echo the input text back`,
		},
		{ role: "user", content: "go" },
	],
	tools: [
		{ type: "function", function: { name: "execute" } },
		{ type: "function", function: { name: "read" } },
	],
};

function primaryBody(
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return { ...CATALOG_BODY, ...extra };
}

describe("classifyRequest", () => {
	test("judge sentinel wins even when tools are offered", () => {
		const body = primaryBody({
			messages: [{ role: "user", content: `hi ${JUDGE_SENTINEL} bye` }],
		});
		expect(classifyRequest(body)).toBe("judge");
	});

	test("non-empty tools array is primary", () => {
		expect(classifyRequest(primaryBody())).toBe("primary");
	});

	test("tool-less request is auxiliary", () => {
		expect(classifyRequest({ messages: [] })).toBe("auxiliary");
		expect(classifyRequest({ messages: [], tools: [] })).toBe("auxiliary");
	});
});

describe("offeredToolNames", () => {
	test("reads function names", () => {
		expect(offeredToolNames(CATALOG_BODY)).toEqual(["execute", "read"]);
	});

	test("missing tools yields empty", () => {
		expect(offeredToolNames({})).toEqual([]);
	});
});

describe("wrapStep", () => {
	test("direct tool call is left alone", () => {
		const step = {
			toolCalls: [{ name: "read", arguments: { path: "x" } }],
		};
		expect(wrapStep(step, CATALOG_BODY)).toEqual(step);
	});

	test("catalog tool is wrapped through execute", () => {
		const wrapped = wrapStep(
			{ toolCalls: [{ name: "spike_echo", arguments: { text: "hi" } }] },
			CATALOG_BODY,
		);
		expect(wrapped.toolCalls).toEqual([
			{
				name: "execute",
				arguments: {
					code: 'return await tools.spike_echo({"text":"hi"})',
				},
			},
		]);
	});

	test("namespaced catalog tool resolves by underscore name", () => {
		const wrapped = wrapStep(
			{
				toolCalls: [
					{ name: "opencode_session_rename", arguments: { title: "t" } },
				],
			},
			CATALOG_BODY,
		);
		expect(wrapped.toolCalls?.[0]?.name).toBe("execute");
		expect(wrapped.toolCalls?.[0]?.arguments).toEqual({
			code: 'return await tools.opencode.session_rename({"title":"t"})',
		});
	});

	test("raw steps are never wrapped", () => {
		const step = {
			raw: true,
			toolCalls: [{ name: "spike_echo", arguments: { text: "hi" } }],
		};
		expect(wrapStep(step, CATALOG_BODY)).toEqual(step);
	});

	test("unknown tool with no catalog path is left unchanged", () => {
		const step = {
			toolCalls: [{ name: "nope", arguments: {} }],
		};
		expect(wrapStep(step, CATALOG_BODY)).toEqual(step);
	});

	test("ambiguous catalog name is left unchanged", () => {
		const body = primaryBody({
			messages: [
				{
					role: "system",
					content: `- a (1 tool)
  - tools.a.dup({
}): Promise<void>
- b (1 tool)
  - tools.b.dup({
}): Promise<void>`,
				},
			],
		});
		const step = { toolCalls: [{ name: "dup", arguments: {} }] };
		expect(wrapStep(step, body)).toEqual(step);
	});

	test("no execute offered means no wrapping", () => {
		const body = primaryBody({
			tools: [{ type: "function", function: { name: "read" } }],
		});
		const step = {
			toolCalls: [{ name: "spike_echo", arguments: { text: "hi" } }],
		};
		expect(wrapStep(step, body)).toEqual(step);
	});
});

describe("startStub http behavior", () => {
	const stubs: Stub[] = [];
	afterEach(async () => {
		while (stubs.length > 0) {
			await stubs.pop()?.stop();
		}
	});

	async function post(url: string, body: unknown): Promise<unknown> {
		const res = await fetch(`${url}/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...(body as object), stream: false }),
		});
		return res.json();
	}

	function assistantText(reply: unknown): unknown {
		return (reply as { choices: [{ message: { content: unknown } }] })
			.choices[0].message.content;
	}

	test("primary consumes the script, then reports exhausted", async () => {
		const stub = await startStub({
			script: [{ text: "first" }],
			recordFile: undefined,
		});
		stubs.push(stub);

		const tools = [{ type: "function", function: { name: "read" } }];
		expect(assistantText(await post(stub.url, { messages: [], tools }))).toBe(
			"first",
		);
		expect(stub.exhausted).toBe(false);
		expect(assistantText(await post(stub.url, { messages: [], tools }))).toBe(
			EXHAUSTED,
		);
		expect(stub.exhausted).toBe(true);
		expect(stub.primary()).toHaveLength(2);
		await stub.waitForPrimary(2);
	});

	test("judge sentinel gets the judge reply", async () => {
		const stub = await startStub({
			script: [{ text: "unused" }],
			judgeReply: '{"pass":true,"reason":"ok"}',
		});
		stubs.push(stub);

		const reply = await post(stub.url, {
			messages: [{ role: "user", content: `x ${JUDGE_SENTINEL}` }],
			tools: [{ type: "function", function: { name: "read" } }],
		});
		expect(assistantText(reply)).toBe('{"pass":true,"reason":"ok"}');
		expect(stub.requests[0]?.kind).toBe("judge");
		// The judge request must not consume the script.
		expect(stub.primary()).toHaveLength(0);
	});

	test("judge without a scripted reply fails closed", async () => {
		const stub = await startStub({ script: [] });
		stubs.push(stub);
		const reply = await post(stub.url, {
			messages: [{ role: "user", content: JUDGE_SENTINEL }],
		});
		expect(String(assistantText(reply))).toContain('"pass":false');
	});

	test("tool-less request gets the title reply", async () => {
		const stub = await startStub({ script: [{ text: "unused" }] });
		stubs.push(stub);
		const reply = await post(stub.url, { messages: [] });
		expect(assistantText(reply)).toBe("Stub title");
		expect(stub.requests[0]?.kind).toBe("auxiliary");
	});

	test("recordFile gets one JSONL line per request", async () => {
		const recordFile = `/tmp/opencode-plugin-ci-stub-test-${process.pid}.jsonl`;
		try {
			await Bun.write(recordFile, "");
		} catch {
			/* created on first append */
		}
		const stub = await startStub({ script: [], recordFile });
		stubs.push(stub);
		await post(stub.url, { messages: [] });
		const lines = (await Bun.file(recordFile).text()).trim().split("\n");
		expect(lines).toHaveLength(1);
		const entry = JSON.parse(lines[0] ?? "") as { seq: number; kind: string };
		expect(entry.seq).toBe(0);
		expect(entry.kind).toBe("auxiliary");
		await Bun.write(recordFile, "");
	});
});
