// Flake-gate orchestration (live tier only, SPEC 7.2, M12):
// read acknowledgments, fetch history via `gh`, decide the verdict with the
// verbatim upstream `decideGateVerdict` (see verdict.ts), map it to an exit
// code, and render the "Flake gate" report section.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config/schema.ts";
import type { CaseResult } from "../report/results.ts";
import type { Logger } from "../util/log.ts";
import { createLogger } from "../util/log.ts";
import {
	fetchHistory,
	gatePrerequisites,
	resolveWorkflowName,
} from "./history.ts";
import {
	decideGateVerdict,
	type GateAcknowledgment,
	type GateHistoryRun,
	type GateVerdict,
	parseAcknowledgments,
} from "./verdict.ts";

export interface GateContext {
	cwd: string;
	config: Config;
	/** Full results of the current run (all tiers/versions). */
	results: CaseResult[];
	requiredVersion: string;
	gateFlag: boolean;
	env?: NodeJS.ProcessEnv;
	logger?: Logger;
	fetchHistoryFn?: typeof fetchHistory;
	prereqFn?: typeof gatePrerequisites;
}

export interface GateOutcome {
	/** False when the gate did not apply (no live cases, disabled, local without --gate). */
	ran: boolean;
	/** Meaningful only when ran (or when acks are malformed): 0/1/2. */
	exitCode: number;
	/** Markdown "Flake gate" section; empty when the gate did not run. */
	section: string;
	verdict?: GateVerdict;
	/** Set when the gate fell back to "fail on any live failure". */
	fallback?: string;
}

/**
 * The gate runs only when ALL hold: the live tier ran with at least one
 * non-skipped case, `gate.enabled`, and either `--gate` was passed or
 * GITHUB_ACTIONS === "true".
 */
export function gateApplies(args: {
	results: CaseResult[];
	config: Config;
	gateFlag: boolean;
	env?: NodeJS.ProcessEnv;
}): boolean {
	const env = args.env ?? process.env;
	if (!args.config.gate.enabled) {
		return false;
	}
	const liveRan = args.results.some(
		(row) => row.tier === "live" && row.skipped === undefined,
	);
	if (!liveRan) {
		return false;
	}
	return args.gateFlag || env.GITHUB_ACTIONS === "true";
}

/** Contents of `.opencode-ci/acknowledgments.json` (human-written). */
export interface AcknowledgmentsFile {
	version: 1;
	acknowledgments: GateAcknowledgment[];
}

/**
 * Read acks; absent file -> empty default. Unlike upstream `e2e-gate.ts`
 * (which fails when the file is absent), SPEC/M12 requires the default so
 * plugin repos are not forced to create the file. Present-but-malformed
 * files throw (fail closed, exit 1). See docs/NOTES.md.
 */
export function readAcknowledgments(cwd: string): AcknowledgmentsFile {
	const path = join(cwd, ".opencode-ci", "acknowledgments.json");
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { version: 1, acknowledgments: [] };
		}
		throw new Error(`cannot read ${path}: ${(error as Error).message}`);
	}
	const parsed = parseAcknowledgments(text);
	if ("error" in parsed) {
		throw new Error(`invalid acknowledgments file at ${path}: ${parsed.error}`);
	}
	return { version: 1, acknowledgments: parsed.acks };
}

/** IDs of non-skipped live rows of the required version that failed now. */
function liveFailedIds(
	results: CaseResult[],
	requiredVersion: string,
): string[] {
	return results
		.filter(
			(row) =>
				row.tier === "live" &&
				row.opencode === requiredVersion &&
				row.skipped === undefined &&
				!row.pass,
		)
		.map((row) => row.id);
}

/** Render the verdict as a Markdown section appended to report.md. */
export function formatGateSection(
	verdict: GateVerdict,
	opts?: { requiredVersion?: string; fallback?: string },
): string {
	const lines: string[] = ["## Flake gate", ""];
	if (opts?.fallback !== undefined) {
		lines.push(`> ${opts.fallback}`, "");
	}
	const label =
		verdict.exit === 0
			? "✅ green"
			: verdict.exit === 1
				? "❌ regression"
				: "⚠️ no history";
	const scope =
		opts?.requiredVersion !== undefined
			? ` (live, opencode ${opts.requiredVersion})`
			: "";
	lines.push(`**Verdict:** ${label}${scope}`, "", `- ${verdict.message}`, "");
	return `${lines.join("\n").trimEnd()}\n`;
}

export async function runGate(ctx: GateContext): Promise<GateOutcome> {
	const env = ctx.env ?? process.env;
	const logger = ctx.logger ?? createLogger();
	if (
		!gateApplies({
			results: ctx.results,
			config: ctx.config,
			gateFlag: ctx.gateFlag,
			env,
		})
	) {
		return { ran: false, exitCode: 0, section: "" };
	}

	let acknowledgments: AcknowledgmentsFile;
	try {
		acknowledgments = readAcknowledgments(ctx.cwd);
	} catch (error) {
		// Fail closed: a malformed file fails the gate (exit 1).
		const message = error instanceof Error ? error.message : String(error);
		logger.error(message);
		const verdict: GateVerdict = { exit: 1, message };
		return {
			ran: true,
			exitCode: 1,
			section: formatGateSection(verdict, {
				requiredVersion: ctx.requiredVersion,
			}),
			verdict,
		};
	}

	const failed: string[] = liveFailedIds(ctx.results, ctx.requiredVersion);

	const checkPrereq = ctx.prereqFn ?? gatePrerequisites;
	const prereq = await checkPrereq(env);
	if (!prereq.ok) {
		// Fall back to "fail on any live failure" when `gh` or a token is missing.
		const fallback =
			`Flake gate unavailable (${prereq.reason}); ` +
			"falling back to fail on any live failure.";
		logger.warn(fallback);
		const verdict: GateVerdict =
			failed.length === 0
				? { exit: 0, message: "all live cases passed." }
				: {
						exit: 1,
						message: `live case(s) failed with no gate history available: ${failed.join(", ")}.`,
					};
		return {
			ran: true,
			exitCode: failed.length === 0 ? 0 : 1,
			section: formatGateSection(verdict, {
				requiredVersion: ctx.requiredVersion,
				fallback,
			}),
			verdict,
			fallback,
		};
	}

	const repo = env.GITHUB_REPOSITORY;
	const branch = env.GITHUB_REF_NAME;
	if (
		repo === undefined ||
		repo.length === 0 ||
		branch === undefined ||
		branch.length === 0
	) {
		const fallback =
			"Flake gate unavailable (GITHUB_REPOSITORY or GITHUB_REF_NAME is not set); " +
			"falling back to fail on any live failure.";
		logger.warn(fallback);
		const verdict: GateVerdict =
			failed.length === 0
				? { exit: 0, message: "all live cases passed." }
				: {
						exit: 1,
						message: `live case(s) failed with no gate history available: ${failed.join(", ")}.`,
					};
		return {
			ran: true,
			exitCode: failed.length === 0 ? 0 : 1,
			section: formatGateSection(verdict, {
				requiredVersion: ctx.requiredVersion,
				fallback,
			}),
			verdict,
			fallback,
		};
	}

	const workflow = resolveWorkflowName(ctx.config.gate.workflow, env);
	if (workflow === undefined) {
		const fallback =
			"Flake gate unavailable (cannot determine the workflow name: set gate.workflow or run from a workflow with GITHUB_WORKFLOW_REF); " +
			"falling back to fail on any live failure.";
		logger.warn(fallback);
		const verdict: GateVerdict =
			failed.length === 0
				? { exit: 0, message: "all live cases passed." }
				: {
						exit: 1,
						message: `live case(s) failed with no gate history available: ${failed.join(", ")}.`,
					};
		return {
			ran: true,
			exitCode: failed.length === 0 ? 0 : 1,
			section: formatGateSection(verdict, {
				requiredVersion: ctx.requiredVersion,
				fallback,
			}),
			verdict,
			fallback,
		};
	}

	const fetch = ctx.fetchHistoryFn ?? fetchHistory;
	let history: GateHistoryRun[];
	try {
		history = await fetch({
			workflow,
			branch,
			repo,
			artifact: ctx.config.gate.artifact,
			requiredVersion: ctx.requiredVersion,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const fallback =
			`Flake gate history fetch failed (${message}); ` +
			"falling back to fail on any live failure.";
		logger.warn(fallback);
		const verdict: GateVerdict =
			failed.length === 0
				? { exit: 0, message: "all live cases passed." }
				: {
						exit: 1,
						message: `live case(s) failed with no gate history available: ${failed.join(", ")}.`,
					};
		return {
			ran: true,
			exitCode: failed.length === 0 ? 0 : 1,
			section: formatGateSection(verdict, {
				requiredVersion: ctx.requiredVersion,
				fallback,
			}),
			verdict,
			fallback,
		};
	}

	// Tally per-case samples over the sampled runs, mirroring e2e-gate.ts:
	// stable means >= 5 samples with a >= 90% pass rate.
	const tally = new Map<string, { samples: number; passes: number }>();
	for (const run of history) {
		for (const [id, pass] of Object.entries(run.passes)) {
			const cell = tally.get(id) ?? { samples: 0, passes: 0 };
			cell.samples += 1;
			if (pass) {
				cell.passes += 1;
			}
			tally.set(id, cell);
		}
	}
	const stable = [...tally]
		.filter(
			([, cell]) => cell.samples >= 5 && cell.passes / cell.samples >= 0.9,
		)
		.map(([id]) => id);
	const verdict = decideGateVerdict({
		failed,
		stable,
		sampled: history.length,
		known: [...tally.keys()],
		history,
		acks: acknowledgments.acknowledgments,
	});
	const exitCode =
		verdict.exit === 2 && ctx.config.gate.bootstrap === "allow"
			? 0
			: verdict.exit;
	if (verdict.exit === 2 && ctx.config.gate.bootstrap === "allow") {
		logger.warn(
			'Flake gate has no history; gate.bootstrap is "allow", continuing with exit 0.',
		);
	}
	logger.info(`[gate] ${verdict.message}`);
	return {
		ran: true,
		exitCode,
		section: formatGateSection(verdict, {
			requiredVersion: ctx.requiredVersion,
		}),
		verdict,
	};
}
