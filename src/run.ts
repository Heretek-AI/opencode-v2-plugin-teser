// Orchestrator for `opencode-plugin-ci run` (M10 order):
// 1. Load + validate config/scenarios.
// 2. Resolve entries (exit 2 when neither server nor TUI exists).
// 3. Run plugin.install / plugin.build once.
// 4. For each opencode version: resolve binary, tier 1 (or static tier 1
//    for TUI-only plugins), then tier 2; tier 3 live scenarios are marked
//    skipped until M11 implements the live tier.
// 5. Run `.opencode-ci/**/*.test.ts` once via `bun test` (programmatic API
//    escape hatch) and fold it in as a `bun-test` scripted case.
// 6. Write results.json + report.md (+ $GITHUB_STEP_SUMMARY).
// 7. Gate (M12; the --gate flag is accepted but warns for now).
// 8. Exit code: 0 when all required cases pass or skip, 1 on a required
//    failure. Results on non-first versions are allowed failures.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadAll } from "./config/load.ts";
import type { Config, Scenario } from "./config/schema.ts";
import { resolveOpencode } from "./opencode/binary.ts";
import { type Entries, ensureEntriesOrThrow } from "./plugin/entry.ts";
import { runStep } from "./plugin/install.ts";
import { appendStepSummary, renderMarkdown } from "./report/markdown.ts";
import type { CaseResult, ResultsFile } from "./report/results.ts";
import { runLoad } from "./tiers/load.ts";
import { concurrencyLimit, pool, runScenario } from "./tiers/scripted.ts";
import { runUiStatic } from "./tiers/ui-static.ts";
import { createLogger, type Logger } from "./util/log.ts";

export type TierName = "load" | "scripted" | "live";

export interface RunOptions {
	cwd?: string;
	tiers?: TierName[];
	scenarios?: string[];
	opencodes?: string[];
	out?: string;
	keep?: boolean;
	gate?: boolean;
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

/** M10 placeholder for the live tier: every live scenario is skipped. */
function skippedLive(
	scenario: Scenario,
	version: string,
	reason: string,
): CaseResult {
	return {
		id: scenario.id,
		tier: "live",
		opencode: version,
		pass: true,
		skipped: reason,
		description: scenario.description,
		durationMs: 0,
	};
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

	const pluginPath = resolve(cwd, config.plugin.path);
	// 2. Resolve entries (throws ConfigError when nothing resolves).
	const entries = ensureEntriesOrThrow(pluginPath, config.plugin.entry);
	const tuiOnly = isTuiOnly(config, entries);
	if (tuiOnly) {
		logger.info("TUI-only plugin: tier 1 is static; tiers 2/3 are skipped.");
	}

	// 3. Install + build once, before any tier.
	if (config.plugin.install !== undefined) {
		logger.info(`Running install step: ${config.plugin.install}`);
		await runStep("install", config.plugin.install, pluginPath);
	}
	if (config.plugin.build !== undefined) {
		logger.info(`Running build step: ${config.plugin.build}`);
		await runStep("build", config.plugin.build, pluginPath);
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
			// M11 implements the live tier; until then every live scenario
			// is reported skipped (never failed) so forks stay green.
			for (const scenario of live) {
				results.push(
					skippedLive(scenario, version, "live tier not implemented (M11)"),
				);
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
			const proc = Bun.spawn(["bun", "test", ".opencode-ci"], {
				cwd,
				env: { ...process.env, OPENCODE_BIN: bin },
				stdout: "pipe",
				stderr: "pipe",
				stdin: "ignore",
			});
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

	// 6. Write results.json + report.md (+ step summary).
	const resultsFile: ResultsFile = {
		version: 1,
		at: new Date().toISOString(),
		tool: toolVersion(),
		plugin: pluginDisplayName(pluginPath),
		results,
	};
	const resultsPath = join(outDir, "results.json");
	const reportPath = join(outDir, "report.md");
	{
		const { ensureDir } = await import("./util/fs.ts");
		ensureDir(outDir);
	}
	writeFileSync(
		resultsPath,
		`${JSON.stringify(resultsFile, null, 2)}\n`,
		"utf8",
	);
	const markdown = renderMarkdown(resultsFile, { allowedVersions });
	writeFileSync(reportPath, markdown, "utf8");
	appendStepSummary(markdown);
	logger.info(
		`Wrote ${relative(cwd, resultsPath)} and ${relative(cwd, reportPath)}.`,
	);

	// 7. Gate (M12): accepted but not implemented yet.
	if (opts?.gate === true) {
		logger.warn(
			"The --gate flag is accepted but the flake gate lands in M12; continuing without gating.",
		);
	}

	// 8. Exit code: required-version failures fail; allowed versions and
	// skips never do.
	const requiredFailures = results.filter(
		(r) => r.opencode === required && !r.pass && r.skipped === undefined,
	);
	return {
		exitCode: requiredFailures.length > 0 ? 1 : 0,
		resultsFile,
		resultsPath,
		reportPath,
	};
}
