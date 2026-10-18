// Tier 2: run one scripted scenario per sandbox against the stub model,
// then evaluate the scenario `expect` block against the recorded evidence.
// Each scenario gets its own stub, sandbox, and evidence directory, so
// scenarios can run concurrently through the `pool` helper below.

import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { evaluate } from "../assert/expect.ts";
import type { Config, Scenario } from "../config/schema.ts";
import { textOf, usage } from "../opencode/events.ts";
import { writeShim } from "../plugin/shim.ts";
import { probePluginDirs, readProbe } from "../probe/read.ts";
import type { CaseResult } from "../report/results.ts";
import { type RunOutput, Sandbox } from "../sandbox/sandbox.ts";
import { startStub } from "../stub/stub.ts";
import { resetDir } from "../util/fs.ts";
import { collectSecretValues, redactSecretValues } from "../util/redact.ts";
import { collectLiveKeys } from "./live.ts";

export interface RunScenarioOptions {
	scenario: Scenario;
	config: Config;
	pluginPath: string;
	serverEntry: string;
	opencodeBin: string;
	outDir: string;
	version: string;
	logLevel?: "info" | "all";
}

/**
 * Run one scenario: stub + sandbox + run + evidence files + evaluate.
 * Never throws for scenario failures; only for setup bugs (missing probe
 * output handling, sandbox crash). Returns the tier-2 CaseResult.
 */
export async function runScenario(
	opts: RunScenarioOptions,
): Promise<CaseResult> {
	const scenario = opts.scenario;
	const evidenceDir = resolve(opts.outDir, opts.version, scenario.id);
	resetDir(evidenceDir, opts.outDir);

	const stub = await startStub({
		script: scenario.script ?? [],
		recordFile: join(evidenceDir, "stub-requests.jsonl"),
		// Configured live-key values may have innocuous names: pass them
		// explicitly. Host env is never scanned — only these live-key values
		// are scrubbed.
		redactValues: collectSecretValues(collectLiveKeys(opts.config)),
	});
	// The shim lives inside the evidence dir (which is kept), not inside
	// the sandbox root (which is deleted on dispose).
	const shimDir = writeShim(evidenceDir, opts.serverEntry);
	const { pre, post } = probePluginDirs();
	const probeOut = join(evidenceDir, "probe-live.jsonl");
	// Scenario options win over config options (shallow merge, SPEC 5.2).
	const pluginOptions = {
		...opts.config.plugin.options,
		...scenario.plugin?.options,
	};
	const sandbox = new Sandbox({
		opencodeBin: opts.opencodeBin,
		stubUrl: stub.url,
		plugins: [
			{ package: pre, options: { out: probeOut, phase: "pre" } },
			{ package: shimDir, options: pluginOptions },
			{ package: post, options: { out: probeOut, phase: "post" } },
		],
		workspace: scenario.workspace,
		logLevel: opts.logLevel ?? opts.config.logLevel,
	});

	const timeoutMs = scenario.timeoutMs ?? 120_000;
	let run: RunOutput | undefined;
	try {
		run = await sandbox.run(scenario.prompt, { timeoutMs });
	} finally {
		// Value-side scrubbing (OCI-7.3-evidence-leaks): persisted evidence
		// must not carry live secret values; in-memory evidence stays raw so
		// assertions still fail on leaks, and probe.jsonl stays raw so
		// `notContains`-style assertions keep seeing the leak.
		const secrets = collectSecretValues(collectLiveKeys(opts.config));
		try {
			if (existsSync(probeOut)) {
				copyFileSync(probeOut, join(evidenceDir, "probe.jsonl"));
			} else {
				writeFileSync(join(evidenceDir, "probe.jsonl"), "");
			}
		} catch {
			writeFileSync(join(evidenceDir, "probe.jsonl"), "");
		}
		writeFileSync(
			join(evidenceDir, "events.jsonl"),
			redactSecretValues(
				(run?.events ?? []).map((e) => JSON.stringify(e)).join("\n") +
					(run?.events?.length ? "\n" : ""),
				secrets,
			),
		);
		writeFileSync(
			join(evidenceDir, "stderr.log"),
			redactSecretValues(run?.stderr ?? "", secrets),
		);
		await stub.stop();
	}
	if (run === undefined) {
		await sandbox.dispose();
		throw new Error(`scenario ${scenario.id}: opencode run failed to start.`);
	}

	// Evaluate before dispose: file assertions read the sandbox project dir.
	const failures: string[] = [];
	const probe = readProbe(join(evidenceDir, "probe.jsonl"));
	try {
		if (run.timedOut) {
			failures.push(`opencode run timed out after ${timeoutMs}ms.`);
		}
		failures.push(
			...evaluate(scenario.expect, {
				run,
				probe,
				stubRequests: stub.requests,
				projectDir: sandbox.project,
				mode: scenario.mode,
			}),
		);
		if (stub.exhausted) {
			failures.push(
				"script exhausted: opencode made more model requests than the script has steps.",
			);
		}
	} finally {
		await sandbox.dispose();
	}

	const used = usage(run.events);
	const text = textOf(run.events);
	const calledTools = [
		...new Set(probe.toolCalls("post").map((call) => call.tool)),
	];
	const stepCount = run.events.filter(
		(e) => e.part?.type === "step-finish",
	).length;
	return {
		id: scenario.id,
		tier: "scripted",
		opencode: opts.version,
		pass: failures.length === 0,
		description: scenario.description,
		failures: failures.length > 0 ? failures : undefined,
		tools: calledTools,
		steps: stepCount,
		costUSD: used.cost,
		tokens: { input: used.input, output: used.output },
		durationMs: run.durationMs,
		textExcerpt: text.slice(0, 300),
		kept: evidenceDir,
	};
}

/** Concurrency for tier 2: min(4, CPUs), at least 1. */
export function concurrencyLimit(): number {
	try {
		return Math.max(1, Math.min(4, availableParallelism()));
	} catch {
		return 4;
	}
}

/**
 * Run `fn` over `items` with at most `limit` in flight. Results keep input
 * order. A rejection rejects the whole pool (callers decide per-item safety).
 */
export async function pool<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array<R>(items.length);
	let next = 0;
	const workerCount = Math.max(1, Math.min(limit, items.length));
	const workers: Promise<void>[] = [];
	for (let w = 0; w < workerCount; w++) {
		workers.push(
			(async () => {
				while (true) {
					const current = next;
					next += 1;
					if (current >= items.length) {
						return;
					}
					const item = items[current] as T;
					results[current] = (await fn(item, current)) as R;
				}
			})(),
		);
	}
	await Promise.all(workers);
	return results;
}
