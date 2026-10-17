// Markdown report rendering (SPEC 7.1, layout ported from e2e-report.ts):
// a header, one table per opencode version, a <details> block per failure,
// and live cost/token totals. Pure function + a step-summary helper; file
// writing lives in run.ts / cli.ts.
import { appendFile } from "../util/fs.ts";
import type { CaseResult, ResultsFile } from "./results.ts";

export interface RenderOptions {
	/** Versions whose failures are allowed (non-required matrix legs). */
	allowedVersions?: string[];
	/** Override the git SHA (defaults to GITHUB_SHA or `git rev-parse`). */
	sha?: string;
}

/** GITHUB_SHA in CI, else `git rev-parse --short HEAD`, else "unknown". */
export function gitSha(): string {
	const fromEnv = process.env.GITHUB_SHA;
	if (fromEnv !== undefined && fromEnv.length > 0) {
		return fromEnv;
	}
	try {
		const proc = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]);
		const out = new TextDecoder().decode(proc.stdout).trim();
		return out.length > 0 ? out : "unknown";
	} catch {
		return "unknown";
	}
}

/**
 * Append the report to $GITHUB_STEP_SUMMARY when set. Best effort: never
 * throws, so a missing summary file cannot fail the run.
 */
export function appendStepSummary(markdown: string): void {
	const file = process.env.GITHUB_STEP_SUMMARY;
	if (file === undefined || file.length === 0) {
		return;
	}
	appendFile(file, `${markdown}\n`);
}

function isSkipped(result: CaseResult): boolean {
	return result.skipped !== undefined;
}

function isFailed(result: CaseResult): boolean {
	return !result.pass && !isSkipped(result);
}

function resultCell(result: CaseResult, allowed: boolean): string {
	if (isSkipped(result)) {
		return result.skipped !== undefined && result.skipped.length > 0
			? `⏭️ skipped (${result.skipped})`
			: "⏭️ skipped";
	}
	if (result.pass) {
		return "✅ pass";
	}
	return allowed ? "⚠️ allowed failure" : "❌ fail";
}

function formatCost(costUSD: number | undefined): string {
	if (costUSD === undefined) {
		return "-";
	}
	return `$${costUSD.toFixed(4)}`;
}

function formatTime(durationMs: number): string {
	if (durationMs >= 1000) {
		return `${(durationMs / 1000).toFixed(1)}s`;
	}
	return `${durationMs}ms`;
}

function formatCount(value: number | undefined): string {
	return value === undefined ? "-" : String(value);
}

/**
 * Derive allowed-failure versions from a results file: unique opencode
 * values in order of first appearance, minus the required (first) version.
 * Mirrors run.ts (`versions.slice(1)`) so `report` re-renders identically.
 */
export function deriveAllowedVersions(results: ResultsFile): string[] {
	const versions: string[] = [];
	for (const result of results.results) {
		if (!versions.includes(result.opencode)) {
			versions.push(result.opencode);
		}
	}
	return versions.slice(1);
}

/** Render one per-version table plus failure details for that version. */
function renderVersionSection(
	version: string,
	cases: CaseResult[],
	required: boolean,
	allowedVersions: string[],
): string {
	const lines: string[] = [];
	lines.push(
		`## opencode ${version}${required ? " (required)" : " (allowed to fail)"}`,
	);
	lines.push("");
	lines.push("| Tier | Case | Result | Tools | Steps | Cost | Time |");
	lines.push("|---|---|---|---|---|---|---|");
	for (const result of cases) {
		const allowed = allowedVersions.includes(result.opencode);
		const tools =
			result.tools !== undefined && result.tools.length > 0
				? result.tools.join(", ")
				: "-";
		lines.push(
			`| ${result.tier} | ${result.id} | ${resultCell(result, allowed)} | ${tools} | ${formatCount(result.steps)} | ${formatCost(result.costUSD)} | ${formatTime(result.durationMs)} |`,
		);
	}
	lines.push("");
	for (const result of cases) {
		if (!isFailed(result)) {
			continue;
		}
		lines.push(
			`<details><summary><code>${result.opencode} / ${result.id}</code> — ${result.tier} failed</summary>`,
		);
		lines.push("");
		for (const failure of result.failures ?? ["(no failure details)"]) {
			lines.push(`- ${failure}`);
		}
		lines.push("");
		if (result.kept !== undefined) {
			lines.push(`Evidence: \`${result.kept}\``);
			lines.push("");
		}
		lines.push("</details>");
		lines.push("");
	}
	return lines.join("\n");
}

/** Render the full report.md for a results file. */
export function renderMarkdown(
	results: ResultsFile,
	opts?: RenderOptions,
): string {
	const allowedVersions = opts?.allowedVersions ?? [];
	const sha = opts?.sha ?? gitSha();
	const versions: string[] = [];
	for (const result of results.results) {
		if (!versions.includes(result.opencode)) {
			versions.push(result.opencode);
		}
	}
	const required = versions.length > 0 ? versions[0] : undefined;

	const passed = results.results.filter((r) => r.pass && !isSkipped(r)).length;
	const failed = results.results.filter((r) => isFailed(r)).length;
	const skipped = results.results.filter((r) => isSkipped(r)).length;

	const lines: string[] = [];
	lines.push("# opencode-plugin-ci report");
	lines.push("");
	lines.push(`- plugin: ${results.plugin}`);
	lines.push(`- tool: ${results.tool}`);
	lines.push(`- opencode: ${versions.length > 0 ? versions.join(", ") : "-"}`);
	lines.push(`- sha: ${sha}`);
	lines.push(`- date: ${results.at}`);
	lines.push("");
	lines.push(
		`**Totals:** ${passed} passed, ${failed} failed, ${skipped} skipped ` +
			`(${results.results.length} cases across ${versions.length} opencode version${versions.length === 1 ? "" : "s"})`,
	);
	lines.push("");

	for (const version of versions) {
		const cases = results.results.filter((r) => r.opencode === version);
		lines.push(
			renderVersionSection(
				version,
				cases,
				version === required,
				allowedVersions,
			),
		);
	}

	const live = results.results.filter(
		(r) => r.tier === "live" && !isSkipped(r),
	);
	if (live.length > 0) {
		const cost = live.reduce((sum, r) => sum + (r.costUSD ?? 0), 0);
		const input = live.reduce((sum, r) => sum + (r.tokens?.input ?? 0), 0);
		const output = live.reduce((sum, r) => sum + (r.tokens?.output ?? 0), 0);
		lines.push(
			`Live totals: $${cost.toFixed(4)} across ${live.length} case${live.length === 1 ? "" : "s"}; ${input} input / ${output} output tokens.`,
		);
		lines.push("");
	}

	return `${lines.join("\n").trimEnd()}\n`;
}
