// Tier 1 for server plugins: load the plugin in a real opencode run and
// assert it registers (inventory), stays silent in the logs, and provides
// every expected tool/command/agent/skill/mcp name.
//
import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ConfigError } from "../config/load.ts";
import { errors, textOf, usage } from "../opencode/events.ts";
import { parseLogs, pluginLogProblems } from "../opencode/logs.ts";
import { writeShim } from "../plugin/shim.ts";
import {
	type InventoryPlugin,
	probePluginDirs,
	readProbe,
} from "../probe/read.ts";
import type { CaseResult } from "../report/results.ts";
import { type RunOutput, Sandbox } from "../sandbox/sandbox.ts";
import { startStub } from "../stub/stub.ts";
import { isFile, resetDir } from "../util/fs.ts";
import { collectSecretValues, redactSecretValues } from "../util/redact.ts";

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

/**
 * Plugin ids this tool installs itself: the pre/post probes. Anything else
 * in the tier-1 inventory was merged from outside the sandbox config (for
 * example an ancestor `opencode.json(c)` opencode walks up to), so it must
 * fail tier 1 closed instead of silently joining the run.
 */
export const PROBE_PLUGIN_IDS = [
	"opencode-plugin-ci.probe.pre",
	"opencode-plugin-ci.probe.post",
] as const;

/** Allowed inventory ids: the probes plus the plugin under test, when known. */
export function expectedInventoryIds(pluginId?: string): string[] {
	return pluginId === undefined
		? [...PROBE_PLUGIN_IDS]
		: [...PROBE_PLUGIN_IDS, pluginId];
}

/**
 * Inventory plugin ids that are not in `expectedIds` (deduped, in first-seen
 * order). Binary builtins (`source.type === "builtin"`, shipped with the
 * opencode binary itself — 86 of them in a clean 2.0.26 inventory) are always
 * allowed. Every other plugin must be one of the configured local packages,
 * matched by id AND by resolved local path: an ancestor `opencode.json(c)`
 * can list foreign npm/local plugins (even under a colliding id), and those
 * have a non-builtin source outside the configured dirs. Anything without a
 * verifiable origin fails closed. An empty result means the sandbox saw
 * exactly the configured set.
 */
export function findUnexpectedPlugins(
	plugins: InventoryPlugin[],
	expectedIds: string[],
	allowedLocalDirs: string[],
): string[] {
	const allowedIds = new Set(expectedIds);
	const extras: string[] = [];
	for (const plugin of plugins) {
		if (isBuiltinPlugin(plugin.source)) {
			continue;
		}
		const path = sourcePathOf(plugin.source);
		const dirOk =
			path !== undefined &&
			allowedLocalDirs.some((dir) => path === dir || dirname(path) === dir);
		if (dirOk && plugin.id !== undefined && allowedIds.has(plugin.id)) {
			continue;
		}
		const id = plugin.id ?? path ?? "(unknown plugin)";
		if (!extras.includes(id)) {
			extras.push(id);
		}
	}
	return extras;
}

function isBuiltinPlugin(source: unknown): boolean {
	return (
		source !== null &&
		typeof source === "object" &&
		(source as { type?: unknown }).type === "builtin"
	);
}

const ANCESTOR_CONFIG_NAMES = ["opencode.json", "opencode.jsonc"] as const;

/**
 * Walk from `startDir` up to the filesystem root, returning the first
 * ancestor `opencode.json(c)` found. opencode merges ancestor configs into
 * every run, so a hit means the sandbox is not isolated. Pure and sync so
 * tests can plant a fake ancestor tree.
 */
export function detectAncestorConfig(startDir: string): string | undefined {
	let dir = resolve(startDir);
	for (;;) {
		for (const name of ANCESTOR_CONFIG_NAMES) {
			if (isFile(join(dir, name))) {
				return join(dir, name);
			}
		}
		const parent = dirname(dir);
		if (parent === dir) {
			return undefined;
		}
		dir = parent;
	}
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
	const serverEntry = opts.serverEntry;

	const evidenceDir = resolve(opts.outDir, opts.version, "load");
	resetDir(evidenceDir, opts.outDir);

	const stub = await startStub({
		script: [{ text: "ok" }],
		recordFile: join(evidenceDir, "stub-requests.jsonl"),
		// Tier 1 has no live keys by construction, so this is the env scan
		// only — still worth it if the ambient env holds a secret-like value.
		redactValues: collectSecretValues(),
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
		// Value-side scrubbing (OCI-7.3-evidence-leaks): persisted evidence
		// must not carry live secret values. The in-memory `run.events` stay
		// raw so assertions still evaluate — and fail on — leaked values;
		// `probe.jsonl` stays raw for the same reason.
		const secrets = collectSecretValues();
		try {
			copyFileSync(probeOut, join(evidenceDir, "probe.jsonl"));
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
		const unexpected = findUnexpectedPlugins(
			inventory.plugins,
			expectedInventoryIds(plugin?.id),
			[pre, shimDir, post],
		);
		if (unexpected.length > 0) {
			failures.push(
				`unexpected plugins in inventory from ancestor config: [${unexpected.join(", ")}].`,
			);
		}
	}

	const ancestorConfig = detectAncestorConfig(sandbox.root);
	if (ancestorConfig !== undefined) {
		failures.push(
			`ancestor opencode config detected at ${ancestorConfig}: sandbox isolation compromised.`,
		);
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
