// OCI-7.3-redact-untested: the probe's SECRET_KEY regex is the security
// boundary between live keys and persisted evidence. Each alternative
// (KEY, TOKEN, SECRET, PASSWORD, AUTH, COOKIE, mixed case) is asserted
// individually with its own canary, so narrowing or breaking the regex for
// any single alternative goes red.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error: probe/core.js is intentionally untyped JS (excluded
// from tsconfig: TS7016); this test pins its runtime redaction behavior.
import { makeProbe } from "../../probe/core.js";
import { cleanupTempDirs, tempDir } from "../helpers/tmp.ts";

afterAll(cleanupTempDirs);

const ALTERNATIVES = ["KEY", "TOKEN", "SECRET", "PASSWORD", "AUTH", "COOKIE"];

type HookHandler = (input: Record<string, unknown>) => unknown;

interface ProbeRecord {
	kind: string;
	env?: Record<string, unknown>;
	headers?: Record<string, unknown>;
	[key: string]: unknown;
}

async function runProbe(
	env: Record<string, string>,
	headers: Record<string, string>,
): Promise<ProbeRecord[]> {
	const dir = tempDir("probe-redact-");
	const out = join(dir, "probe.jsonl");
	const handlers = new Map<string, HookHandler>();
	const register =
		(prefix: string) =>
		async (name: string, fn: HookHandler): Promise<void> => {
			handlers.set(`${prefix}.${name}`, fn);
		};
	const ctx = {
		options: { out },
		tool: { hook: register("tool") },
		shell: { hook: register("shell") },
		session: { hook: register("session") },
		event: { subscribe: () => (async function* () {})() },
		plugin: { list: async () => [] },
	};
	const probe = makeProbe("pre");
	await probe.setup(ctx);
	const shellBefore = handlers.get("shell.create.before");
	await shellBefore?.({ command: "env", cwd: "/", shell: "bash", env });
	const modelRequest = handlers.get("session.model.request");
	await modelRequest?.({
		kind: "request",
		model: "m",
		baseURL: "u",
		headers,
	});
	const lines = readFileSync(out, "utf8")
		.split("\n")
		.filter((line) => line.trim() !== "");
	return lines.map((line) => JSON.parse(line) as ProbeRecord);
}

describe("probe SECRET_KEY redaction", () => {
	for (const alt of ALTERNATIVES) {
		test(`redacts ${alt} (mixed case) in shell env and model headers`, async () => {
			// Canary values contain only their own alternative, so dropping
			// any single alternative from the regex leaks exactly its canary.
			const envKey = `My_Svc_${alt.toLowerCase()}_Value`;
			const envCanary = `canary-${alt}-0001`;
			const headerCanary = `header-${alt}-0002`;
			const records = await runProbe(
				{ [envKey]: envCanary },
				{ [`X-Custom-${alt}`]: headerCanary },
			);
			const shell = records.find((r) => r.kind === "shell.before");
			expect(shell?.env?.[envKey]).toBe("[redacted]");
			expect(JSON.stringify(shell)).not.toContain(envCanary);
			const request = records.find((r) => r.kind === "session.model.request");
			expect(request?.headers?.[`X-Custom-${alt}`]).toBe("[redacted]");
			expect(JSON.stringify(request)).not.toContain(headerCanary);
		});
	}

	test("non-secret values pass through untouched", async () => {
		const records = await runProbe(
			{ NORMAL_VAR: "visible", API_KEY: "sk-live-value" },
			{ "Content-Type": "application/json" },
		);
		const shell = records.find((r) => r.kind === "shell.before");
		expect(shell?.env?.NORMAL_VAR).toBe("visible");
		expect(shell?.env?.API_KEY).toBe("[redacted]");
		const request = records.find((r) => r.kind === "session.model.request");
		expect(request?.headers?.["Content-Type"]).toBe("application/json");
	});
});
