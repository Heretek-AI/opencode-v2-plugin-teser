// Fetch prior `results.json` files with `gh` (ported from
// Heretek-AI/IUMBTEMS `scripts/e2e-gate.ts`, Apache-2.0; see NOTICE).
// Adaptations vs upstream: async `Bun.spawn` with an injectable runner
// (upstream uses `Bun.spawnSync`, which cannot run without `gh`), and one
// entry per sampled run as a `GateHistoryRun` (the verbatim verdict input)
// instead of an inline tally. Every external call goes through the runner
// so unit tests never touch the network.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GateHistoryRun } from "./verdict.ts";

export const DEFAULT_RESULTS_ARTIFACT = "opencode-plugin-ci-results";
export const HISTORY_RUN_LIMIT = 15;

export interface FetchHistoryOptions {
	workflow: string;
	branch: string;
	repo: string;
	artifact: string;
	requiredVersion: string;
	tmpDir?: string;
	/** How many completed runs to list (newest first). Defaults to 15. */
	limit?: number;
}

export interface RunCommandResult {
	code: number;
	stdout: string;
	stderr: string;
}

/** Runs a command; defaults to async `gh` spawn. Injected in tests. */
export type CommandRunner = (args: string[]) => Promise<RunCommandResult>;

async function defaultRunner(args: string[]): Promise<RunCommandResult> {
	const proc = Bun.spawn(["gh", ...args], {
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout as ReadableStream).text(),
		new Response(proc.stderr as ReadableStream).text(),
	]);
	const code = await proc.exited;
	return { code, stdout, stderr };
}

interface GhRunEntry {
	databaseId?: unknown;
	conclusion?: unknown;
	createdAt?: unknown;
}

/**
 * Parse a workflow file name out of GITHUB_WORKFLOW_REF
 * (`owner/repo/.github/workflows/<file>@ref` -> `<file>`).
 * Returns undefined when the ref is missing or has no workflows marker.
 */
export function parseWorkflowName(ref: string | undefined): string | undefined {
	if (ref === undefined || ref.length === 0) {
		return undefined;
	}
	const at = ref.indexOf("@");
	const path = at >= 0 ? ref.slice(0, at) : ref;
	const marker = ".github/workflows/";
	const markerIndex = path.indexOf(marker);
	if (markerIndex < 0) {
		return undefined;
	}
	const file = path.slice(markerIndex + marker.length);
	if (file.length === 0 || file.includes("/")) {
		return undefined;
	}
	return file;
}

/** Resolve the workflow file name: explicit config wins, else GITHUB_WORKFLOW_REF. */
export function resolveWorkflowName(
	configured: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	if (configured !== undefined && configured.length > 0) {
		return configured;
	}
	return parseWorkflowName(env.GITHUB_WORKFLOW_REF);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Fetch live-tier history: list completed runs of the workflow on the
 * branch (newest first), download the results artifact from each, and keep
 * the live rows of the required opencode version as one `GateHistoryRun`
 * per sampled run (newest first). Runs whose conclusion is not
 * success/failure, whose download fails, whose results.json is unreadable,
 * or that have no matching rows are skipped. A missing `createdAt` keeps
 * the run's position (id order) but its timestamp sorts as newer than any
 * acknowledgment (fail closed), mirroring `e2e-gate.ts`.
 */
export async function fetchHistory(
	opts: FetchHistoryOptions,
	run: CommandRunner = defaultRunner,
): Promise<GateHistoryRun[]> {
	const limit = opts.limit ?? HISTORY_RUN_LIMIT;
	const list = await run([
		"run",
		"list",
		"--workflow",
		opts.workflow,
		"--branch",
		opts.branch,
		"--status",
		"completed",
		"--limit",
		String(limit),
		"--json",
		"databaseId,conclusion,createdAt",
		"--repo",
		opts.repo,
	]);
	if (list.code !== 0) {
		throw new Error(
			`gh run list failed (exit ${list.code}): ${list.stderr.trim().slice(0, 500)}`,
		);
	}
	let entries: unknown;
	try {
		entries = JSON.parse(list.stdout) as unknown;
	} catch {
		throw new Error("gh run list returned invalid JSON.");
	}
	if (!Array.isArray(entries)) {
		throw new Error(
			"gh run list returned an unexpected shape (expected an array).",
		);
	}
	const runs = (entries.filter(isRecord) as GhRunEntry[])
		.filter(
			(entry) =>
				(entry.conclusion === "success" || entry.conclusion === "failure") &&
				typeof entry.databaseId === "number",
		)
		.map((entry) => ({
			id: entry.databaseId as number,
			createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
		}))
		.sort((a, b) =>
			a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
		);

	const tmpRoot =
		opts.tmpDir ?? mkdtempSync(join(tmpdir(), "opencode-ci-gate-"));
	const history: GateHistoryRun[] = [];
	for (const entry of runs) {
		const dir = join(tmpRoot, String(entry.id));
		const download = await run([
			"run",
			"download",
			String(entry.id),
			"--name",
			opts.artifact,
			"--dir",
			dir,
			"--repo",
			opts.repo,
		]);
		if (download.code !== 0) {
			// Artifact missing (expired, or an older run without one): skip.
			continue;
		}
		let passes: Record<string, boolean>;
		try {
			const text = readFileSync(join(dir, "results.json"), "utf8");
			const parsed = JSON.parse(text) as { results?: unknown };
			if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
				continue;
			}
			passes = {};
			for (const row of parsed.results) {
				if (!isRecord(row)) {
					continue;
				}
				if (
					row.tier !== "live" ||
					row.opencode !== opts.requiredVersion ||
					row.skipped !== undefined ||
					typeof row.id !== "string" ||
					typeof row.pass !== "boolean"
				) {
					continue;
				}
				passes[row.id] = row.pass;
			}
		} catch {
			continue;
		}
		if (Object.keys(passes).length > 0) {
			history.push({ id: String(entry.id), at: entry.createdAt, passes });
		}
	}
	return history;
}

/** True when `gh` runs and a token is configured. */
export async function gatePrerequisites(
	env: NodeJS.ProcessEnv = process.env,
	run: CommandRunner = defaultRunner,
): Promise<{ ok: true } | { ok: false; reason: string }> {
	if (
		(env.GH_TOKEN ?? "").length === 0 &&
		(env.GITHUB_TOKEN ?? "").length === 0
	) {
		return {
			ok: false,
			reason:
				"no GH_TOKEN or GITHUB_TOKEN is set, so history cannot be fetched.",
		};
	}
	try {
		const probe = await run(["--version"]);
		if (probe.code !== 0) {
			return {
				ok: false,
				reason: "`gh` is not available (gh --version failed).",
			};
		}
	} catch {
		return { ok: false, reason: "`gh` is not available." };
	}
	return { ok: true };
}
