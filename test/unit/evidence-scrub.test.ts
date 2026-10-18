// OCI-7.3-evidence-leaks: only env/headers are redacted at the source, so
// prompt/tool I/O, stub requests, events and the report get value-side
// scrubbing of known live secret values before they are persisted. The
// in-memory evidence stays raw so assertions still see — and fail on —
// leaked values.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderMarkdown } from "../../src/report/markdown.ts";
import type { ResultsFile } from "../../src/report/results.ts";
import { type Stub, startStub } from "../../src/stub/stub.ts";
import {
	collectSecretValues,
	redactSecretValues,
} from "../../src/util/redact.ts";
import { cleanupTempDirs, tempDir } from "../helpers/tmp.ts";

afterAll(cleanupTempDirs);

const CANARY = "sk-test-SYSTEM-SECRET-0001";

describe("redactSecretValues", () => {
	test("replaces every occurrence with [redacted]", () => {
		expect(redactSecretValues(`a ${CANARY} b ${CANARY}`, [CANARY])).toBe(
			"a [redacted] b [redacted]",
		);
	});

	test("longer overlapping values scrub completely", () => {
		expect(
			redactSecretValues("xxsecret12xx", ["secret12", "xxsecret12xx"]),
		).toBe("[redacted]");
	});

	test("values with regex metacharacters match literally", () => {
		const value = "a.b*c+d?e(f)g[h]i{j}k|l^m$n";
		expect(redactSecretValues(`[${value}]`, [value])).toBe("[[redacted]]");
	});

	test("empty, whitespace-only and short values are skipped", () => {
		expect(redactSecretValues("abc 123", ["", "   ", "123"])).toBe("abc 123");
		// Anything under 8 chars — including common env noise like "false"
		// (e.g. TOKENIZERS_PARALLELISM=false) — is never scrubbed.
		expect(
			redactSecretValues("Defaults to false; code 1234567", [
				"false",
				"1234567",
			]),
		).toBe("Defaults to false; code 1234567");
	});

	test("scrubs each value's JSON-escaped form as well", () => {
		const value = `sec"ret\\key-123`;
		expect(value.length).toBeGreaterThanOrEqual(8);
		const line = JSON.stringify({ content: `print ${value} now` });
		expect(line).toContain(value.slice(0, 3));
		// The raw value does not appear literally in the JSON line (quotes
		// and backslashes are escaped), yet scrubbing must still catch it.
		expect(line).not.toContain(value);
		const scrubbed = redactSecretValues(line, [value]);
		expect(scrubbed).not.toContain(JSON.stringify(value).slice(1, -1));
		expect(scrubbed).toContain("[redacted]");
		// And the raw form is still scrubbed where it appears literally.
		expect(redactSecretValues(`saw ${value} here`, [value])).toBe(
			"saw [redacted] here",
		);
	});

	test("never throws and returns text unchanged on malformed input", () => {
		expect(
			redactSecretValues("keep false intact", ["false", 42 as never]),
		).toBe("keep false intact");
		expect(
			redactSecretValues("untouched", undefined as unknown as string[]),
		).toBe("untouched");
	});
	test("clean text and an empty secret list pass through", () => {
		expect(redactSecretValues("nothing here", [CANARY])).toBe("nothing here");
		expect(redactSecretValues(`has ${CANARY}`, [])).toBe(`has ${CANARY}`);
	});
});

describe("collectSecretValues", () => {
	const saved = new Map<string, string | undefined>();

	afterEach(() => {
		for (const [name, value] of saved) {
			if (value === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = value;
			}
		}
		saved.clear();
	});

	function setEnv(name: string, value: string): void {
		if (!saved.has(name)) {
			saved.set(
				name,
				Object.hasOwn(process.env, name) ? process.env[name] : undefined,
			);
		}
		process.env[name] = value;
	}

	test("picks up explicit key values and ignores host env", () => {
		setEnv("OCI_SCRUB_TEST_KEY", CANARY);
		setEnv("OCI_SCRUB_TEST_PLAIN", "not-a-secret-name");
		setEnv("TOKENIZERS_PARALLELISM", "false");
		// Host env is never scanned, even for secret-looking names.
		expect(collectSecretValues()).toEqual([]);
		const values = collectSecretValues({ MY_API: "explicit-key-value" });
		expect(values).toContain("explicit-key-value");
		expect(values).not.toContain(CANARY);
		expect(values).not.toContain("not-a-secret-name");
		expect(values).not.toContain("false");
	});

	test("an explicitly passed value is picked up even if secret-named", () => {
		setEnv("OCI_SCRUB_TEST_KEY", CANARY);
		expect(collectSecretValues({ MY_API: CANARY })).toContain(CANARY);
	});
});

describe("evidence scrubbing", () => {
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

	test("stub recordFile scrubs secret values but memory stays raw", async () => {
		const dir = tempDir("evidence-scrub-");
		const recordFile = join(dir, "stub-requests.jsonl");
		const stub = await startStub({
			script: [{ text: "done" }],
			recordFile,
			redactValues: [CANARY],
		});
		stubs.push(stub);
		await post(stub.url, {
			messages: [{ role: "user", content: `print ${CANARY}` }],
			tools: [{ type: "function", function: { name: "read" } }],
		});
		const persisted = readFileSync(recordFile, "utf8");
		expect(persisted).not.toContain(CANARY);
		expect(persisted).toContain("[redacted]");
		// Assertions evaluate the in-memory record, so the leak is still
		// visible (and catchable) there.
		expect(JSON.stringify(stub.requests[0]?.body)).toContain(CANARY);
	});

	test("host env noise (TOKENIZERS_PARALLELISM=false) leaves evidence JSONL valid", async () => {
		const had = Object.hasOwn(process.env, "TOKENIZERS_PARALLELISM")
			? process.env.TOKENIZERS_PARALLELISM
			: undefined;
		process.env.TOKENIZERS_PARALLELISM = "false";
		try {
			const dir = tempDir("evidence-scrub-r2-");
			const recordFile = join(dir, "stub-requests.jsonl");
			const stub = await startStub({
				script: [{ text: "Defaults to false." }],
				recordFile,
				redactValues: collectSecretValues(),
			});
			stubs.push(stub);
			await post(stub.url, {
				messages: [{ role: "user", content: "Defaults to false." }],
				tools: [{ type: "function", function: { name: "read" } }],
			});
			const persisted = readFileSync(recordFile, "utf8");
			expect(persisted).toContain("false");
			expect(persisted).not.toContain("[redacted]");
			for (const line of persisted.trim().split("\n")) {
				JSON.parse(line);
			}
		} finally {
			if (had === undefined) {
				delete process.env.TOKENIZERS_PARALLELISM;
			} else {
				process.env.TOKENIZERS_PARALLELISM = had;
			}
		}
	});

	test("report markdown scrubs secret values from failures", () => {
		const results: ResultsFile = {
			version: 1,
			at: "2026-10-18T00:00:00.000Z",
			tool: "test",
			plugin: "test",
			results: [
				{
					id: "leaky",
					tier: "scripted",
					opencode: "2.0.26",
					pass: false,
					failures: [`text: expected not to contain "x", got "${CANARY}".`],
					durationMs: 1,
					textExcerpt: `saw ${CANARY}`,
				},
			],
		};
		const raw = renderMarkdown(results, { allowedVersions: [] });
		expect(raw).toContain(CANARY);
		const scrubbed = redactSecretValues(raw, [CANARY]);
		expect(scrubbed).not.toContain(CANARY);
		expect(scrubbed).toContain("[redacted]");
	});
});
