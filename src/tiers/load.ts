// Tier 1 for server plugins: load the plugin in a real opencode run and
// assert it registers (inventory), stays silent in the logs, and provides
// every expected tool/command/agent/skill/mcp name.
//
import { copyFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ConfigError } from "../config/load.ts";
import { errors, textOf, usage } from "../opencode/events.ts";
import { parseLogs, pluginLogProblems } from "../opencode/logs.ts";
import { writeShim } from "../plugin/shim.ts";
import { probePluginDirs, readProbe } from "../probe/read.ts";
import type { CaseResult } from "../report/results.ts";
import { type RunOutput, Sandbox } from "../sandbox/sandbox.ts";
import { startStub } from "../stub/stub.ts";
import { resetDir } from "../util/fs.ts";

// Re-exported so existing importers (`./load.ts`) keep working.
export type { CaseResult } from "../report/results.ts";

export interface LoadTierExpected {
	tools?: string[];
	commands?: string[];
	agents?: string[];
	skills?: string[];
	mcp?: string[];
}

export interface RunLoadOptions {
	pluginPath: string;
	/** Absolute server entry, resolved once by the caller (honors plugin.entry). */
	serverEntry: string;
	pluginOptions?: Record<string, unknown>;
	opencodeBin: string;
	outDir: string;
	version: string;
	expected?: LoadTierExpected;
	logLevel?: "info" | "all";
}

/** First three lines of a (possibly multiline) error string. */
function firstLines(text: string, count = 3): string {
	return text.split("\n").slice(0, count).join("\n");
}

function sourcePathOf(source: unknown): string | undefined {
	if (typeof source === "string") {
		return source;
	}
	if (source !== null && typeof source === "object") {
		const path = (source as Record<string, unknown>).path;
		return typeof path === "string" ? path : undefined;
	}
	return undefined;
}

/**
 * Run tier 1: boot opencode with [probe/pre, shimmed plugin, probe/post],
 * say "Reply with ok.", write evidence to <outDir>/<version>/load/, and
 * assert the plugin registered cleanly. Never throws for tier failures;
 * only for setup bugs (missing entry, sandbox crash).
 */
export async function runLoad(opts: RunLoadOptions): Promise<CaseResult> {
	const pluginPath = resolve(opts.pluginPath);
	const serverEntry = opts.serverEntry;

	const evidenceDir = resolve(opts.outDir, opts.version, "load");
	resetDir(evidenceDir, opts.outDir);

	const stub = await startStub({
		script: [{ text: "ok" }],
		recordFile: join(evidenceDir, "stub-requests.jsonl"),
	});
	// The shim lives inside the evidence dir (which is kept), not inside
	// the sandbox root (which is deleted on dispose).
	const shimDir = writeShim(evidenceDir, serverEntry);
	const shimServerJs = join(shimDir, "server.js");
	const { pre, post } = probePluginDirs();
	const probeOut = join(evidenceDir, "probe-live.jsonl");
	const sandbox = new Sandbox({
		opencodeBin: opts.opencodeBin,
		stubUrl: stub.url,
		plugins: [
			{ package: pre, options: { out: probeOut, phase: "pre" } },
			{ package: shimDir, options: opts.pluginOptions ?? {} },
			{ package: post, options: { out: probeOut, phase: "post" } },
		],
		logLevel: opts.logLevel ?? "info",
	});

	const failures: string[] = [];
	let run: RunOutput | undefined;
	try {
		run = await sandbox.run("Reply with ok.");
	} finally {
		try {
			copyFileSync(probeOut, join(evidenceDir, "probe.jsonl"));
		} catch {
			writeFileSync(join(evidenceDir, "probe.jsonl"), "");
		}
		writeFileSync(
			join(evidenceDir, "events.jsonl"),
			(run?.events ?? []).map((e) => JSON.stringify(e)).join("\n") +
				(run?.events?.length ? "\n" : ""),
		);
		writeFileSync(join(evidenceDir, "stderr.log"), run?.stderr ?? "");
		await stub.stop();
		await sandbox.dispose();
	}
	if (run === undefined) {
		throw new ConfigError("opencode run failed to start.");
	}

	if (run.timedOut) {
		failures.push("opencode run timed out.");
	}
	if (run.code !== 0) {
		failures.push(`opencode exited with code ${run.code}.`);
	}
	const errorEvents = errors(run.events);
	if (errorEvents.length > 0) {
		const first = errorEvents[0]?.error;
		failures.push(
			`opencode reported ${errorEvents.length} error event(s)` +
				(first?.message ? `: ${first.message}` : "."),
		);
	}

	const probe = readProbe(join(evidenceDir, "probe.jsonl"));
	const inventory = probe.inventory;
	if (inventory === undefined) {
		failures.push("probe inventory missing: opencode never reached a prompt.");
	} else {
		const plugin = inventory.plugins.find(
			(p) => sourcePathOf(p.source) === shimServerJs,
		);
		if (plugin === undefined) {
			failures.push(
				`plugin never registered. opencode loads only server.*/index.* ` +
					`from a directory; the resolved entry was ${serverEntry}.`,
			);
		} else if (plugin.status === "failed") {
			failures.push(
				`plugin setup failed: ${firstLines(String(plugin.error ?? "unknown error"))}`,
			);
		}
		const lines = parseLogs(run.stderr);
		// Stack traces name the real entry, not the shim: check both paths.
		const problems = [
			...pluginLogProblems(lines, { id: plugin?.id, path: shimServerJs }),
			...pluginLogProblems(lines, { path: serverEntry }),
		].filter((line, index, all) => all.indexOf(line) === index);
		for (const line of problems) {
			failures.push(`plugin log problem: ${line._raw}`);
		}
		const expected = opts.expected ?? {};
		const groups: Array<[string, string[] | undefined, string[]]> = [
			["tool", expected.tools, inventory.tools],
			["command", expected.commands, inventory.commands],
			["agent", expected.agents, inventory.agents],
			["skill", expected.skills, inventory.skills],
			["mcp", expected.mcp, inventory.mcp],
		];
		for (const [kind, wanted, have] of groups) {
			for (const name of wanted ?? []) {
				if (!have.includes(name)) {
					failures.push(
						`expected ${kind} ${JSON.stringify(name)} not in inventory ${kind}s [${have.join(", ")}].`,
					);
				}
			}
		}
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
		id: "load",
		tier: "load",
		opencode: opts.version,
		pass: failures.length === 0,
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
