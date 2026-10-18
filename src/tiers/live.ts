// Tier 3: live scenarios against the user's real provider and model, with a
// k-of-n pass rule, a run-wide USD budget, and an optional judge (M11).
//
// Without a configured API key the tier reports every live scenario as
// skipped (never failed), so fork PRs without secrets stay green.
import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { evaluate, getOutputText } from "../assert/expect.ts";
import type { Config, Scenario } from "../config/schema.ts";
import { textOf, usage } from "../opencode/events.ts";
import { writeShim } from "../plugin/shim.ts";
import { type ProbeLog, probePluginDirs, readProbe } from "../probe/read.ts";
import type { CaseResult } from "../report/results.ts";
import { type RunOutput, Sandbox } from "../sandbox/sandbox.ts";
import { resetDir } from "../util/fs.ts";
import { runJudge } from "./judge.ts";

/** Run-wide budget counter, shared by every live scenario in a run. */
export interface LiveBudget {
	spent: number;
	limit: number;
}

export interface RunLiveScenarioOptions {
	scenario: Scenario;
	config: Config;
	pluginPath: string;
	serverEntry: string;
	opencodeBin: string;
	outDir: string;
	version: string;
	logLevel?: "info" | "all";
	budget: LiveBudget;
	/** Pre-resolved model; resolved via `resolveModel` when omitted. */
	model?: string;
	/** Pre-collected keys; collected from `process.env` when omitted. */
	keys?: Record<string, string>;
}

/**
 * Collect the configured live key names from `process.env`. Only names are
 * ever surfaced (in the skip message); values travel exclusively into the
 * sandbox env and are never logged.
 */
export function collectLiveKeys(config: Config): Record<string, string> {
	const collected: Record<string, string> = {};
	for (const name of config.live.keys) {
		const value = process.env[name];
		if (value !== undefined && value.length > 0) {
			collected[name] = value;
		}
	}
	return collected;
}

export function noKeySkipReason(config: Config): string {
	return `no API key (set one of: ${config.live.keys.join(", ")})`;
}

export function budgetExhaustedReason(budget: LiveBudget): string {
	return `budget exhausted ($${budget.spent.toFixed(2)} of $${budget.limit.toFixed(2)})`;
}

export interface ResolveModelOptions {
	opencodeBin: string;
	/** Live keys to pass through (auth may widen the model list). */
	keys: Record<string, string>;
	/** Bare model id (`config.live.model` without a slash), if configured. */
	preferred?: string;
	timeoutMs?: number;
	log?: (message: string) => void;
}

async function listModels(
	opencodeBin: string,
	keys: Record<string, string>,
	timeoutMs: number,
): Promise<string[]> {
	const root = join(
		tmpdir(),
		`opencode-plugin-ci-models-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
	);
	mkdirSync(join(root, "home"), { recursive: true });
	const env: Record<string, string> = {
		PATH: process.env.PATH ?? "",
		TERM: "dumb",
		HOME: join(root, "home"),
		XDG_CONFIG_HOME: join(root, "config"),
		XDG_DATA_HOME: join(root, "data"),
		XDG_CACHE_HOME: join(root, "cache"),
		XDG_STATE_HOME: join(root, "state"),
		OPENCODE_DISABLE_AUTOUPDATE: "1",
		OPENCODE_DISABLE_MODELS_FETCH: "1",
		...keys,
	};
	const child: ChildProcess = spawn(opencodeBin, ["models"], {
		cwd: root,
		stdio: ["ignore", "pipe", "pipe"],
		env,
	});
	let stdout = "";
	let stderr = "";
	child.stdout?.on("data", (chunk: Buffer) => {
		stdout += chunk.toString();
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
	const code: number = await new Promise((resolvePromise) => {
		child.on("error", () => resolvePromise(-1));
		child.on("close", (exitCode) => resolvePromise(exitCode ?? -1));
	});
	clearTimeout(timer);
	if (code !== 0) {
		throw new Error(
			`"opencode models" exited with code ${code}: ${stderr.trim().slice(0, 300)}`,
		);
	}
	const lines: string[] = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		// Model ids look like `provider/model` with no whitespace.
		if (/^[^\s]+\/[^\s]+$/.test(trimmed)) {
			lines.push(trimmed);
		}
	}
	return lines;
}

/**
 * Resolve the live model: a `provider/model` value is used as is, otherwise
 * `opencode models` is consulted (bare id matched as a `/<id>` suffix,
 * preferring `opencode-go/` then `opencode/`). With no preference, the first
 * `opencode/` model wins. Throws a descriptive error when nothing matches.
 */
export async function resolveModel(opts: ResolveModelOptions): Promise<string> {
	const preferred = opts.preferred?.trim() ?? "";
	if (preferred.includes("/")) {
		return preferred;
	}
	const lines = await listModels(
		opts.opencodeBin,
		opts.keys,
		opts.timeoutMs ?? 60_000,
	);
	if (preferred.length > 0) {
		const suffix = `/${preferred}`;
		const candidates = lines.filter((line) => line.endsWith(suffix));
		const go = candidates.find((line) => line.startsWith("opencode-go/"));
		if (go !== undefined) {
			return go;
		}
		const direct = candidates.find((line) => line.startsWith("opencode/"));
		if (direct !== undefined) {
			return direct;
		}
		if (candidates.length > 0) {
			return candidates[0] as string;
		}
		throw new Error(
			`could not resolve live model "${preferred}": no "opencode models" line ends with "${suffix}" (${lines.length} models listed).`,
		);
	}
	const first = lines.find((line) => line.startsWith("opencode/"));
	if (first === undefined) {
		throw new Error(
			`could not resolve a default live model: no "opencode models" line starts with "opencode/" (${lines.length} models listed).`,
		);
	}
	(opts.log ?? console.log)(`Resolved live model: ${first}.`);
	return first;
}

/** One evidence line per post-phase tool call, clipped for the judge prompt. */
function summarizeToolCalls(probe: ProbeLog): string {
	return probe
		.toolCalls("post")
		.map((call) => {
			const input = JSON.stringify(call.input ?? null);
			const output = getOutputText(call.result);
			const clipped = output.length > 500 ? `${output.slice(0, 500)}…` : output;
			return `- ${call.tool} (${call.status ?? "?"}): input ${input} -> ${clipped}`;
		})
		.join("\n");
}

/** Record counts per `kind@phase`, so the judge sees what was observed. */
function summarizeHooks(probe: ProbeLog): string {
	const counts = new Map<string, number>();
	for (const record of probe.records) {
		const key = `${record.kind}@${record.phase ?? "?"}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([key, count]) => `- ${key}: ${count}`)
		.join("\n");
}

function readExpectedFiles(scenario: Scenario, projectDir: string): string {
	const sections: string[] = [];
	for (const file of scenario.expect.files ?? []) {
		const absolute = resolve(projectDir, file.path);
		let content: string;
		try {
			content = readFileSync(absolute, "utf8");
		} catch {
			content = "<file not found>";
		}
		const clipped =
			content.length > 8000 ? `${content.slice(0, 8000)}…[truncated]` : content;
		sections.push(`=== ${file.path} ===\n${clipped}`);
	}
	return sections.join("\n\n");
}

function skippedLive(
	scenario: Scenario,
	version: string,
	reason: string,
	evidenceDir: string,
	attempts: { pass: boolean; failures: string[] }[],
): CaseResult {
	return {
		id: scenario.id,
		tier: "live",
		opencode: version,
		pass: true,
		skipped: reason,
		description: scenario.description,
		attempts,
		durationMs: 0,
		kept: evidenceDir,
	};
}

/**
 * Run one live scenario: up to `repeat` attempts against the real model,
 * stopping early once `pass` attempts passed or passing became impossible.
 * Each attempt costs `usage(events).cost` against the shared budget, and the
 * judge runs only when deterministic checks passed and a rubric exists.
 * Never throws for scenario failures; only for sandbox crashes.
 */
export async function runLiveScenario(
	opts: RunLiveScenarioOptions,
): Promise<CaseResult> {
	const scenario = opts.scenario;
	const evidenceDir = resolve(opts.outDir, opts.version, scenario.id);
	resetDir(evidenceDir, opts.outDir);

	const keys = opts.keys ?? collectLiveKeys(opts.config);
	if (Object.keys(keys).length === 0) {
		return skippedLive(
			scenario,
			opts.version,
			noKeySkipReason(opts.config),
			evidenceDir,
			[],
		);
	}

	let model = opts.model;
	if (model === undefined) {
		try {
			model = await resolveModel({
				opencodeBin: opts.opencodeBin,
				keys,
				preferred: opts.config.live.model,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				id: scenario.id,
				tier: "live",
				opencode: opts.version,
				pass: false,
				description: scenario.description,
				failures: [`could not resolve live model: ${message}`],
				durationMs: 0,
				kept: evidenceDir,
			};
		}
	}
	const resolvedModel = model;

	// Live models are slower than the stub: an unset scenario timeout uses
	// config.live.timeoutMs [240000], not the scripted default.
	const timeoutMs = scenario.timeoutMs ?? opts.config.live.timeoutMs;
	const need = opts.config.live.pass;
	const maxAttempts = opts.config.live.repeat;
	const attempts: { pass: boolean; failures: string[] }[] = [];
	const calledTools = new Set<string>();
	let passed = 0;
	let costUSD = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let stepCount = 0;
	let durationMs = 0;
	let textExcerpt: string | undefined;
	let judge: { pass: boolean; reason: string } | undefined;
	let budgetStop: string | undefined;

	for (let n = 0; n < maxAttempts; n++) {
		if (passed >= need) {
			break;
		}
		if (passed + (maxAttempts - n) < need) {
			break;
		}
		if (opts.budget.spent >= opts.budget.limit) {
			if (attempts.length > 0) {
				// Attempts already ran and fewer than `pass` passed: stopping
				// here must fail the case, never hide those attempts as a skip.
				budgetStop = budgetExhaustedReason(opts.budget);
				break;
			}
			return {
				id: scenario.id,
				tier: "live",
				opencode: opts.version,
				pass: true,
				skipped: budgetExhaustedReason(opts.budget),
				description: scenario.description,
				attempts,
				costUSD,
				tokens: { input: inputTokens, output: outputTokens },
				durationMs,
				judge,
				kept: evidenceDir,
			};
		}

		const attemptDir = join(evidenceDir, `attempt-${n + 1}`);
		mkdirSync(attemptDir, { recursive: true });
		// The shim lives inside the attempt dir (which is kept), not inside
		// the sandbox root (which is deleted on dispose).
		const shimDir = writeShim(attemptDir, opts.serverEntry);
		const { pre, post } = probePluginDirs();
		const probeOut = join(attemptDir, "probe-live.jsonl");
		// Scenario options win over config options (shallow merge, SPEC 5.2).
		const pluginOptions = {
			...opts.config.plugin.options,
			...scenario.plugin?.options,
		};
		const sandbox = new Sandbox({
			opencodeBin: opts.opencodeBin,
			liveModel: resolvedModel,
			plugins: [
				{ package: pre, options: { out: probeOut, phase: "pre" } },
				{ package: shimDir, options: pluginOptions },
				{ package: post, options: { out: probeOut, phase: "post" } },
			],
			workspace: scenario.workspace,
			env: keys,
			logLevel: opts.logLevel ?? opts.config.logLevel,
		});

		let run: RunOutput | undefined;
		try {
			run = await sandbox.run(scenario.prompt, { timeoutMs });
		} finally {
			try {
				copyFileSync(probeOut, join(attemptDir, "probe.jsonl"));
			} catch {
				writeFileSync(join(attemptDir, "probe.jsonl"), "");
			}
			writeFileSync(
				join(attemptDir, "events.jsonl"),
				(run?.events ?? []).map((e) => JSON.stringify(e)).join("\n") +
					(run?.events?.length ? "\n" : ""),
			);
			writeFileSync(join(attemptDir, "stderr.log"), run?.stderr ?? "");
		}
		if (run === undefined) {
			await sandbox.dispose();
			throw new Error(`scenario ${scenario.id}: opencode run failed to start.`);
		}

		// Evaluate (file assertions read the sandbox project dir) and gather
		// judge inputs before dispose deletes the project.
		const failures: string[] = [];
		const probe = readProbe(join(attemptDir, "probe.jsonl"));
		let judgeFiles: string | undefined;
		try {
			if (run.timedOut) {
				failures.push(`opencode run timed out after ${timeoutMs}ms.`);
			}
			failures.push(
				...evaluate(scenario.expect, {
					run,
					probe,
					stubRequests: [],
					projectDir: sandbox.project,
					mode: "live",
				}),
			);
		} finally {
			// Judge file evidence must be read while the project still exists.
			if (failures.length === 0 && scenario.judge !== undefined) {
				judgeFiles = readExpectedFiles(scenario, sandbox.project);
			}
			await sandbox.dispose();
		}

		const used = usage(run.events);
		costUSD += used.cost;
		inputTokens += used.input;
		outputTokens += used.output;
		opts.budget.spent += used.cost;
		stepCount += run.events.filter(
			(e) => e.part?.type === "step-finish",
		).length;
		durationMs += run.durationMs;
		for (const call of probe.toolCalls("post")) {
			calledTools.add(call.tool);
		}
		textExcerpt = textOf(run.events).slice(0, 300);

		if (failures.length === 0 && scenario.judge !== undefined) {
			const started = Date.now();
			const outcome = await runJudge({
				rubric: scenario.judge.rubric,
				model: resolvedModel,
				judgeModel: scenario.judge.model,
				opencodeBin: opts.opencodeBin,
				env: keys,
				evidenceDir: attemptDir,
				logLevel: opts.logLevel ?? opts.config.logLevel,
				timeoutMs,
				text: textOf(run.events),
				toolCalls: summarizeToolCalls(probe),
				hookSummary: summarizeHooks(probe),
				files: judgeFiles,
			});
			durationMs += Date.now() - started;
			costUSD += outcome.costUSD;
			inputTokens += outcome.tokens.input;
			outputTokens += outcome.tokens.output;
			opts.budget.spent += outcome.costUSD;
			judge = outcome.verdict;
			if (!outcome.verdict.pass) {
				failures.push(`judge: ${outcome.verdict.reason}`);
			}
		}

		const pass = failures.length === 0;
		attempts.push({ pass, failures });
		if (pass) {
			passed += 1;
		}
	}

	const overallPass = passed >= need;
	const failures =
		overallPass || attempts.length === 0
			? undefined
			: [
					`live scenario ${scenario.id}: ${passed} of ${attempts.length} attempt(s) passed, needed ${need} of ${maxAttempts}${budgetStop === undefined ? "" : ` (${budgetStop})`}.`,
					...attempts.flatMap((attempt, index) =>
						attempt.pass
							? []
							: attempt.failures.map(
									(failure) => `attempt ${index + 1}: ${failure}`,
								),
					),
				];
	return {
		id: scenario.id,
		tier: "live",
		opencode: opts.version,
		pass: overallPass,
		description: scenario.description,
		failures,
		tools: [...calledTools],
		steps: stepCount,
		costUSD,
		tokens: { input: inputTokens, output: outputTokens },
		durationMs,
		textExcerpt,
		attempts,
		judge,
		kept: evidenceDir,
	};
}
