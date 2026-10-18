// Orchestrator for `opencode-plugin-ci run`:
// 1. Load + validate config/scenarios (and every --scenario id).
// 2. Run plugin.install / plugin.build once (a failure is exit 1).
// 3. Resolve entries (exit 2 when neither server nor TUI exists). This must
//    follow the build: the entry is often a build output such as dist/.
// 4. For each opencode version: resolve binary, tier 1 (or static tier 1
//    for TUI-only plugins), then tier 2 (scripted), then tier 3 (live,
//    sequential with a shared run-wide budget).
// 5. Run `.opencode-ci/**/*.test.ts` once via `bun test` (programmatic API
//    escape hatch) and fold it in as a `bun-test` scripted case.
// 6. Write results.json + report.md (+ $GITHUB_STEP_SUMMARY).
// 7. Flake gate (live tier only): when it applies, required-version live
//    failures are decided by the gate; tiers 1 and 2 always fail directly.
// 8. Exit code: 0 when all required cases pass or skip, 1 on a required
//    failure. Results on non-first versions are allowed failures.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ConfigError, loadAll } from "./config/load.ts";
import type { Config, Scenario } from "./config/schema.ts";
import { runGate } from "./gate/gate.ts";
import { resolveOpencode } from "./opencode/binary.ts";
import { type Entries, ensureEntriesOrThrow } from "./plugin/entry.ts";
import { runStep } from "./plugin/install.ts";
import { appendStepSummary, renderMarkdown } from "./report/markdown.ts";
import type { CaseResult, ResultsFile } from "./report/results.ts";
import {
	budgetExhaustedReason,
	collectLiveKeys,
	type LiveBudget,
	noKeySkipReason,
	resolveModel,
	runLiveScenario,
} from "./tiers/live.ts";
import { runLoad } from "./tiers/load.ts";
import { concurrencyLimit, pool, runScenario } from "./tiers/scripted.ts";
import { runUiStatic } from "./tiers/ui-static.ts";
import { appendFile, ensureDir } from "./util/fs.ts";
import { createLogger, type Logger } from "./util/log.ts";
import { collectSecretValues, redactSecretValues } from "./util/redact.ts";

export type TierName = "load" | "scripted" | "live";

export interface RunOptions {
	cwd?: string;
	tiers?: TierName[];
	scenarios?: string[];
	opencodes?: string[];
	out?: string;
	keep?: boolean;
	gate?: boolean;
	/** Overrides gate.artifact; the Action passes its artifact-name input. */
	gateArtifact?: string;
	verbose?: boolean;
	quiet?: boolean;
}

export interface RunOutcome {
	exitCode: number;
	resultsFile: ResultsFile;
	resultsPath: string;
	reportPath: string;
}

const VALID_TIERS: TierName[] = ["load", "scripted", "live"];

/** True for TUI-only plugins: forced via config, or no server entry. */
export function isTuiOnly(config: Config, entries: Entries): boolean {
	if (config.plugin.ui === true) {
		return true;
	}
	if (config.plugin.ui === false) {
		return false;
	}
	return entries.server === undefined;
}

function toolVersion(): string {
	try {
		const text = readFileSync(
			new URL("../package.json", import.meta.url),
			"utf8",
		);
		const pkg = JSON.parse(text) as { version?: unknown };
		return typeof pkg.version === "string" ? pkg.version : "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function pluginDisplayName(pluginPath: string): string {
	try {
		const pkg = JSON.parse(
			readFileSync(join(pluginPath, "package.json"), "utf8"),
		) as { name?: unknown };
		if (typeof pkg.name === "string" && pkg.name.length > 0) {
			return pkg.name;
		}
	} catch {
		// Fall through to the path fallback.
	}
	return pluginPath;
}

// Recursively collect ".opencode-ci" test files ("*.test.ts") under cwd.
function findProgrammaticTests(cwd: string): string[] {
	const root = join(cwd, ".opencode-ci");
	const out: string[] = [];
	const walk = (dir: string): void => {
		let names: string[];
		try {
			names = readdirSync(dir);
		} catch {
			return;
		}
		for (const name of names.sort()) {
			const full = join(dir, name);
			let isDir = false;
			try {
				isDir = statSync(full).isDirectory();
			} catch {
				continue;
			}
			if (isDir) {
				walk(full);
			} else if (name.endsWith(".test.ts")) {
				out.push(full);
			}
		}
	};
	walk(root);
	return out;
}

function skippedForTier1(scenario: Scenario, version: string): CaseResult {
	return {
		id: scenario.id,
		tier: scenario.mode === "live" ? "live" : "scripted",
		opencode: version,
		pass: true,
		skipped: "tier 1 failed",
		description: scenario.description,
		durationMs: 0,
	};
}

function skippedTuiOnly(scenario: Scenario, version: string): CaseResult {
	return {
		id: scenario.id,
		tier: scenario.mode === "live" ? "live" : "scripted",
		opencode: version,
		pass: true,
		skipped: "TUI-only plugin",
		description: scenario.description,
		durationMs: 0,
	};
}

/**
 * Replace known live secret values in display strings before persisting
 * (OCI-7.3-evidence-leaks). Outcomes (`pass`, `skipped`, counts) and the
 * evidence dirs are untouched, so the gate and exit codes behave identically.
 */
function scrubRow(row: CaseResult, secrets: string[]): CaseResult {
	if (secrets.length === 0) {
		return row;
	}
	const scrub = (text: string): string => redactSecretValues(text, secrets);
	return {
		...row,
		failures: row.failures?.map(scrub),
		textExcerpt:
			row.textExcerpt === undefined ? undefined : scrub(row.textExcerpt),
		attempts: row.attempts?.map((attempt) => ({
			...attempt,
			failures: attempt.failures.map(scrub),
		})),
		judge:
			row.judge === undefined
				? undefined
				: { ...row.judge, reason: scrub(row.judge.reason) },
	};
}

export async function runCi(opts?: RunOptions): Promise<RunOutcome> {
	const cwd = resolve(opts?.cwd ?? process.cwd());
	const logger: Logger = createLogger({
		quiet: opts?.quiet,
		verbose: opts?.verbose,
	});
	const wantedTiers = opts?.tiers ?? VALID_TIERS;
	const wantedScenarios = opts?.scenarios;

	// 1. Load + validate (fail closed: ConfigError -> exit 2 upstream).
	const { config, scenarios, warnings } = loadAll(cwd);
	for (const warning of warnings) {
		logger.warn(warning);
	}

	const unknown = (wantedScenarios ?? []).filter(
		(id) => !scenarios.some((scenario) => scenario.id === id),
	);
	if (unknown.length > 0) {
		throw new ConfigError(
			`unknown --scenario id(s): ${unknown.join(", ")} (known: ${scenarios.map((s) => s.id).join(", ") || "none"}).`,
		);
	}

	const pluginPath = resolve(cwd, config.plugin.path);
	// 2. Install + build once, before resolving entries: the entry is often
	// a build output (dist/server.js) that does not exist in a fresh checkout.
	if (config.plugin.install !== undefined) {
		logger.info(`Running install step: ${config.plugin.install}`);
		await runStep("install", config.plugin.install, pluginPath);
	}
	if (config.plugin.build !== undefined) {
		logger.info(`Running build step: ${config.plugin.build}`);
		await runStep("build", config.plugin.build, pluginPath);
	}

	// 3. Resolve entries (throws ConfigError when nothing resolves).
	const entries = ensureEntriesOrThrow(pluginPath, config.plugin.entry);
	const tuiOnly = isTuiOnly(config, entries);
	if (tuiOnly) {
		logger.info("TUI-only plugin: tier 1 is static; tiers 2/3 are skipped.");
	}

	const versions =
		opts?.opencodes !== undefined && opts.opencodes.length > 0
			? opts.opencodes
			: config.opencode.versions;
	const required = versions[0] as string;
	const allowedVersions = versions.slice(1);
	const outDir = resolve(opts?.out ?? join(cwd, ".opencode-ci/out"));

	if (opts?.keep === true) {
		// Sandboxes honor this env var in dispose(); threading a flag
		// through every tier API would churn the M8/M9 signatures.
		process.env.OPENCODE_PLUGIN_CI_KEEP = "1";
	}

	const logLevel = opts?.verbose === true ? "all" : config.logLevel;
	const matchScenario = (scenario: Scenario): boolean =>
		wantedScenarios === undefined ||
		wantedScenarios.length === 0 ||
		wantedScenarios.includes(scenario.id);

	const results: CaseResult[] = [];
	// One budget for the whole live tier across every opencode version
	// (SPEC 5.1: "hard stop for the whole live tier").
	const budget: LiveBudget = { spent: 0, limit: config.live.budgetUSD };

	// 4. One pass per opencode version.
	for (const version of versions) {
		logger.info(`Resolving opencode ${version}...`);
		const { bin } = await resolveOpencode(version);

		const runTier1 = wantedTiers.includes("load");
		const runScripted = wantedTiers.includes("scripted");
		const runLive = wantedTiers.includes("live");

		let tier1Pass = true;
		if (runTier1) {
			logger.info(`[${version}] tier 1 (load)...`);
			const tier1 = tuiOnly
				? await runUiStatic({ pluginPath, outDir, version })
				: await runLoad({
						pluginPath,
						serverEntry: entries.server as string,
						pluginOptions: config.plugin.options,
						opencodeBin: bin,
						outDir,
						version,
						expected: {
							tools: config.expect.tools,
							commands: config.expect.commands,
							agents: config.expect.agents,
							skills: config.expect.skills,
							mcp: config.expect.mcp,
						},
						logLevel,
					});
			results.push(tier1);
			tier1Pass = tier1.pass;
			logger.info(`[${version}] tier 1 ${tier1.pass ? "passed" : "failed"}.`);
		}

		const scripted = scenarios.filter(
			(s) => s.mode === "scripted" && matchScenario(s),
		);
		const live = scenarios.filter((s) => s.mode === "live" && matchScenario(s));

		if (!tier1Pass) {
			// A failing tier 1 would fail every later tier for the same
			// reason, so report them as skipped instead of noisy red.
			for (const scenario of [...scripted, ...live]) {
				if (
					(scenario.mode === "scripted" && !runScripted) ||
					(scenario.mode === "live" && !runLive)
				) {
					continue;
				}
				results.push(skippedForTier1(scenario, version));
			}
			continue;
		}

		if (tuiOnly) {
			for (const scenario of [...scripted, ...live]) {
				if (
					(scenario.mode === "scripted" && !runScripted) ||
					(scenario.mode === "live" && !runLive)
				) {
					continue;
				}
				results.push(skippedTuiOnly(scenario, version));
			}
			continue;
		}

		if (runScripted && entries.server !== undefined) {
			logger.info(
				`[${version}] tier 2: ${scripted.length} scripted scenario(s)...`,
			);
			const ran = await pool(scripted, concurrencyLimit(), (scenario) =>
				runScenario({
					scenario,
					config,
					pluginPath,
					serverEntry: entries.server as string,
					opencodeBin: bin,
					outDir,
					version,
					logLevel,
				}),
			);
			results.push(...ran);
		}

		if (runLive) {
			// Tier 3 runs sequentially: attempts share one run-wide budget
			// counter, so parallel runs would race the accounting.
			const pending = live;
			if (pending.length > 0) {
				const keys = collectLiveKeys(config);
				if (Object.keys(keys).length === 0) {
					const reason = noKeySkipReason(config);
					logger.info(`[${version}] tier 3: ${reason}.`);
					for (const scenario of pending) {
						results.push({
							id: scenario.id,
							tier: "live",
							opencode: version,
							pass: true,
							skipped: reason,
							description: scenario.description,
							durationMs: 0,
						});
					}
				} else {
					let model: string | undefined;
					try {
						model = await resolveModel({
							opencodeBin: bin,
							keys,
							preferred: config.live.model,
							log: (message) => logger.info(message),
						});
						logger.info(`[${version}] tier 3 live model: ${model}.`);
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						logger.warn(
							`[${version}] tier 3 model resolution failed: ${message}`,
						);
						for (const scenario of pending) {
							results.push({
								id: scenario.id,
								tier: "live",
								opencode: version,
								pass: false,
								description: scenario.description,
								failures: [`could not resolve live model: ${message}`],
								durationMs: 0,
							});
						}
					}
					if (model !== undefined) {
						logger.info(
							`[${version}] tier 3: ${pending.length} live scenario(s), budget $${budget.limit.toFixed(2)}...`,
						);
						for (const scenario of pending) {
							if (budget.spent >= budget.limit) {
								results.push({
									id: scenario.id,
									tier: "live",
									opencode: version,
									pass: true,
									skipped: budgetExhaustedReason(budget),
									description: scenario.description,
									durationMs: 0,
								});
								continue;
							}
							results.push(
								await runLiveScenario({
									scenario,
									config,
									pluginPath,
									serverEntry: entries.server as string,
									opencodeBin: bin,
									outDir,
									version,
									logLevel,
									budget,
									model,
									keys,
								}),
							);
						}
					}
				}
			}
		}
	}

	// 5. Programmatic escape hatch: run "bun test .opencode-ci" once, with
	// OPENCODE_BIN pointing at the required version's binary.
	if (wantedTiers.includes("scripted")) {
		const testFiles = findProgrammaticTests(cwd);
		if (testFiles.length > 0) {
			logger.info(`Running programmatic tests: ${testFiles.length} file(s)...`);
			const { bin } = await resolveOpencode(required);
			const started = Date.now();
			// Explicit "./" paths: `bun test <dir>` skips dot-directories, so a
			// ".opencode-ci" filter never matches any file (bun 1.4.2).
			const proc = Bun.spawn(
				["bun", "test", ...testFiles.map((file) => `./${relative(cwd, file)}`)],
				{
					cwd,
					env: { ...process.env, OPENCODE_BIN: bin },
					stdout: "pipe",
					stderr: "pipe",
					stdin: "ignore",
				},
			);
			const [stdout, stderr] = await Promise.all([
				new Response(proc.stdout as ReadableStream).text(),
				new Response(proc.stderr as ReadableStream).text(),
			]);
			const code = await proc.exited;
			const output = `${stdout}\n${stderr}`.trim();
			const tail = output.length > 0 ? output.split("\n").slice(-40) : [];
			results.push({
				id: "bun-test",
				tier: "scripted",
				opencode: required,
				pass: code === 0,
				failures:
					code === 0
						? undefined
						: tail.length > 0
							? tail
							: [`bun test .opencode-ci exited with code ${code}.`],
				steps: testFiles.length,
				durationMs: Date.now() - started,
				textExcerpt: output.slice(0, 300),
				kept: outDir,
			});
			logger.info(
				`Programmatic tests ${code === 0 ? "passed" : `failed (exit ${code})`}.`,
			);
		}
	}

	// 6. Write results.json + report.md (+ step summary). Known live secret
	// values are scrubbed from display strings before anything is persisted
	// or summarized; in-memory verdicts were already computed on raw text.
	const secrets = collectSecretValues(collectLiveKeys(config));
	const scrubbed = results.map((row) => scrubRow(row, secrets));
	const resultsFile: ResultsFile = {
		version: 1,
		at: new Date().toISOString(),
		tool: toolVersion(),
		plugin: pluginDisplayName(pluginPath),
		results: scrubbed,
	};
	const resultsPath = join(outDir, "results.json");
	const reportPath = join(outDir, "report.md");
	ensureDir(outDir);
	writeFileSync(
		resultsPath,
		`${JSON.stringify(resultsFile, null, 2)}\n`,
		"utf8",
	);
	const markdown = redactSecretValues(
		renderMarkdown(resultsFile, { allowedVersions }),
		secrets,
	);
	writeFileSync(reportPath, markdown, "utf8");
	appendStepSummary(markdown);
	logger.info(
		`Wrote ${relative(cwd, resultsPath)} and ${relative(cwd, reportPath)}.`,
	);

	// 7. Gate: when it applies, required-version live failures are decided
	// by the gate instead of failing directly. Tiers 1 and 2 always fail.
	const gateConfig: Config =
		opts?.gateArtifact === undefined
			? config
			: { ...config, gate: { ...config.gate, artifact: opts.gateArtifact } };
	const gateOutcome = await runGate({
		cwd,
		config: gateConfig,
		results,
		requiredVersion: required,
		gateFlag: opts?.gate === true,
		logger,
	});
	if (gateOutcome.ran) {
		const section = redactSecretValues(gateOutcome.section, secrets);
		appendFile(reportPath, section);
		appendStepSummary(section);
		logger.info(
			`Flake gate: exit ${gateOutcome.verdict?.exit ?? "unknown"} (exit ${gateOutcome.exitCode}).`,
		);
	}

	// 8. Exit code: required-version non-live failures always fail; live
	// failures fail unless the gate ran and tolerated them. Allowed
	// versions and skips never fail.
	const nonLiveFailures = results.filter(
		(r) =>
			r.opencode === required &&
			!r.pass &&
			r.skipped === undefined &&
			r.tier !== "live",
	);
	const liveFailures = results.filter(
		(r) =>
			r.opencode === required &&
			!r.pass &&
			r.skipped === undefined &&
			r.tier === "live",
	);
	let exitCode: number;
	if (nonLiveFailures.length > 0) {
		exitCode = 1;
	} else if (gateOutcome.ran) {
		exitCode = gateOutcome.exitCode;
	} else {
		exitCode = liveFailures.length > 0 ? 1 : 0;
	}
	return {
		exitCode,
		resultsFile,
		resultsPath,
		reportPath,
	};
}
