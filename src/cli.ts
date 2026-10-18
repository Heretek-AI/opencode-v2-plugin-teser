// Argument parsing and command dispatch. Parsed by hand; no CLI framework.
//
// opencode-plugin-ci init        [--force]
// opencode-plugin-ci validate
// opencode-plugin-ci run         [--tier load|scripted|live]... [--scenario id]...
//                                [--opencode v]... [--out dir] [--keep] [--gate]
//                                [--verbose] [--quiet]
// opencode-plugin-ci report      [<results.json>]
// opencode-plugin-ci --version | --help
//
// Exit codes: 0 pass, 1 failure, 2 configuration error / unknown arguments.
import {
	copyFileSync,
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, loadAll } from "./config/load.ts";
import { versionSchema } from "./config/schema.ts";
import { type Entries, ensureEntriesOrThrow } from "./plugin/entry.ts";
import {
	appendStepSummary,
	deriveAllowedVersions,
	renderMarkdown,
} from "./report/markdown.ts";
import type { ResultsFile } from "./report/results.ts";
import { isTuiOnly, runCi, type TierName } from "./run.ts";
import { ensureDir } from "./util/fs.ts";
import { createLogger } from "./util/log.ts";

const USAGE = `opencode-plugin-ci

Usage:
  opencode-plugin-ci init [--force]
  opencode-plugin-ci validate
  opencode-plugin-ci run [--tier load|scripted|live] [--scenario <id>] [--opencode <v>] [--out <dir>] [--keep] [--gate] [--verbose] [--quiet]
  opencode-plugin-ci report [<results.json>]
  opencode-plugin-ci --version
  opencode-plugin-ci --help
`;

/** Usage/validation error inside the CLI: always exits 2. */
class UsageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UsageError";
	}
}

async function readVersion(): Promise<string> {
	const pkgUrl = new URL("../package.json", import.meta.url);
	const file = Bun.file(pkgUrl);
	const pkg = (await file.json()) as { version?: string };
	if (typeof pkg.version !== "string" || pkg.version.length === 0) {
		throw new Error("package.json has no version");
	}
	return pkg.version;
}

function takeValue(args: string[], i: number, flag: string): string {
	const value = args[i + 1];
	if (value === undefined || value.startsWith("-")) {
		throw new UsageError(`${flag} needs a value.`);
	}
	return value;
}

/** Split `--flag a,b --flag c` style repeatable values on commas. */
function collectValues(raw: string[]): string[] {
	const out: string[] = [];
	for (const item of raw) {
		for (const part of item.split(",")) {
			const trimmed = part.trim();
			if (trimmed.length > 0) {
				out.push(trimmed);
			}
		}
	}
	return out;
}

export interface RunFlags {
	tiers: TierName[];
	scenarios: string[];
	opencodes: string[];
	out?: string;
	keep: boolean;
	gate: boolean;
	verbose: boolean;
	quiet: boolean;
}

export function parseRunArgs(args: string[]): RunFlags {
	const tiers: TierName[] = [];
	const scenarios: string[] = [];
	const opencodes: string[] = [];
	let out: string | undefined;
	let keep = false;
	let gate = false;
	let verbose = false;
	let quiet = false;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] as string;
		if (arg === "--tier" || arg.startsWith("--tier=")) {
			const raw =
				arg === "--tier"
					? takeValue(args, i, "--tier")
					: arg.slice("--tier=".length);
			if (arg === "--tier") {
				i++;
			}
			for (const tier of collectValues([raw])) {
				if (tier !== "load" && tier !== "scripted" && tier !== "live") {
					throw new UsageError(
						`Unknown --tier ${JSON.stringify(tier)}: expected load, scripted or live.`,
					);
				}
				tiers.push(tier);
			}
		} else if (arg === "--scenario" || arg.startsWith("--scenario=")) {
			const raw =
				arg === "--scenario"
					? takeValue(args, i, "--scenario")
					: arg.slice("--scenario=".length);
			if (arg === "--scenario") {
				i++;
			}
			scenarios.push(...collectValues([raw]));
		} else if (arg === "--opencode" || arg.startsWith("--opencode=")) {
			const raw =
				arg === "--opencode"
					? takeValue(args, i, "--opencode")
					: arg.slice("--opencode=".length);
			if (arg === "--opencode") {
				i++;
			}
			for (const version of collectValues([raw])) {
				// The version becomes an evidence path segment, so it must
				// never contain path syntax: same rule as opencode.versions.
				if (!versionSchema.safeParse(version).success) {
					throw new UsageError(
						`Invalid --opencode ${JSON.stringify(version)}: expected x.y.z or "latest".`,
					);
				}
				opencodes.push(version);
			}
		} else if (arg === "--out" || arg.startsWith("--out=")) {
			out =
				arg === "--out"
					? takeValue(args, i, "--out")
					: arg.slice("--out=".length);
			if (arg === "--out") {
				i++;
			}
		} else if (arg === "--keep") {
			keep = true;
		} else if (arg === "--gate") {
			gate = true;
		} else if (arg === "--verbose") {
			verbose = true;
		} else if (arg === "--quiet") {
			quiet = true;
		} else if (arg === "--help" || arg === "-h") {
			console.log(USAGE);
			process.exit(0);
		} else {
			throw new UsageError(`Unknown argument for run: ${arg}`);
		}
	}
	return { tiers, scenarios, opencodes, out, keep, gate, verbose, quiet };
}

function exampleSourceDir(): string {
	return fileURLToPath(new URL("../examples/.opencode-ci", import.meta.url));
}

function listFilesRecursive(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir).sort()) {
		const full = join(dir, name);
		let isDir = false;
		try {
			isDir = statSync(full).isDirectory();
		} catch {
			continue;
		}
		if (isDir) {
			out.push(...listFilesRecursive(full));
		} else {
			out.push(full);
		}
	}
	return out;
}

async function cmdInit(args: string[]): Promise<number> {
	let force = false;
	for (const arg of args) {
		if (arg === "--force") {
			force = true;
		} else if (arg === "--help" || arg === "-h") {
			console.log(USAGE);
			return 0;
		} else {
			console.error(`Unknown argument for init: ${arg}\n`);
			console.error(USAGE);
			return 2;
		}
	}
	const cwd = process.cwd();
	const source = exampleSourceDir();
	if (!existsSync(source)) {
		console.error(`Init templates missing: ${source} does not exist.`);
		return 2;
	}
	const files = listFilesRecursive(source);
	const dest = join(cwd, ".opencode-ci");
	const planned = files.map((file) =>
		join(dest, file.slice(source.length + 1)),
	);
	const existing = planned.filter((file) => existsSync(file));
	if (existing.length > 0 && !force) {
		console.error(
			`Refusing to overwrite ${existing.length} existing file(s) (e.g. ${existing[0]}). Re-run with --force to overwrite.`,
		);
		return 2;
	}
	for (let i = 0; i < files.length; i++) {
		ensureDir(join(planned[i] as string, ".."));
		copyFileSync(files[i] as string, planned[i] as string);
	}
	console.log(
		`Wrote ${planned.length} file(s) to ${dest}${force ? " (overwrote existing files)." : "."}`,
	);
	return 0;
}

async function cmdValidate(): Promise<number> {
	const cwd = process.cwd();
	const logger = createLogger();
	try {
		const { config, scenarios, warnings } = loadAll(cwd);
		for (const warning of warnings) {
			logger.warn(warning);
		}
		const pluginPath = resolve(cwd, config.plugin.path);
		let entries: Entries | undefined;
		try {
			entries = ensureEntriesOrThrow(pluginPath, config.plugin.entry);
		} catch (error) {
			// The entry may be a build output that `validate` never builds;
			// `run` resolves entries again after plugin.build.
			if (
				!(error instanceof ConfigError) ||
				config.plugin.build === undefined
			) {
				throw error;
			}
			logger.warn(
				`${error.message} (plugin.build is set, so run checks again after building).`,
			);
		}
		const tuiOnly = entries !== undefined && isTuiOnly(config, entries);
		const byMode = new Map<string, number>();
		for (const scenario of scenarios) {
			byMode.set(scenario.mode, (byMode.get(scenario.mode) ?? 0) + 1);
		}
		console.log(`plugin: ${pluginPath}${tuiOnly ? " (TUI-only)" : ""}`);
		console.log(
			entries === undefined
				? "entries: not found yet (created by plugin.build?)"
				: `entries: server=${entries.server ?? "-"} tui=${entries.tui ?? "-"}`,
		);
		console.log(`opencode versions: ${config.opencode.versions.join(", ")}`);
		console.log(
			`scenarios: ${scenarios.length}` +
				(byMode.size > 0
					? ` (${[...byMode.entries()].map(([mode, n]) => `${n} ${mode}`).join(", ")})`
					: ""),
		);
		return 0;
	} catch (error) {
		if (error instanceof ConfigError) {
			console.error(`Configuration error: ${error.message}`);
			return 2;
		}
		throw error;
	}
}

async function cmdRun(args: string[]): Promise<number> {
	let flags: RunFlags;
	try {
		flags = parseRunArgs(args);
	} catch (error) {
		if (error instanceof UsageError) {
			console.error(`${error.message}\n`);
			console.error(USAGE);
			return 2;
		}
		throw error;
	}
	try {
		const outcome = await runCi({
			tiers: flags.tiers.length > 0 ? flags.tiers : undefined,
			scenarios: flags.scenarios.length > 0 ? flags.scenarios : undefined,
			opencodes: flags.opencodes.length > 0 ? flags.opencodes : undefined,
			out: flags.out,
			keep: flags.keep,
			gate: flags.gate,
			verbose: flags.verbose,
			quiet: flags.quiet,
		});
		return outcome.exitCode;
	} catch (error) {
		if (error instanceof ConfigError) {
			console.error(`Configuration error: ${error.message}`);
			return 2;
		}
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

function readResultsFile(path: string): ResultsFile {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		throw new UsageError(`Results file not found: ${path}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch {
		throw new UsageError(`Results file is not valid JSON: ${path}`);
	}
	if (
		parsed === null ||
		typeof parsed !== "object" ||
		!Array.isArray((parsed as { results?: unknown }).results)
	) {
		throw new UsageError(
			`Results file has no results array: ${path} (expected results.json from \`run\`).`,
		);
	}
	return parsed as ResultsFile;
}

async function cmdReport(args: string[]): Promise<number> {
	let target: string | undefined;
	for (const arg of args) {
		if (arg === "--help" || arg === "-h") {
			console.log(USAGE);
			return 0;
		}
		if (arg.startsWith("-")) {
			console.error(`Unknown argument for report: ${arg}\n`);
			console.error(USAGE);
			return 2;
		}
		if (target !== undefined) {
			console.error("report takes at most one results.json path.\n");
			console.error(USAGE);
			return 2;
		}
		target = arg;
	}
	const resultsPath = resolve(
		target ?? join(process.cwd(), ".opencode-ci/out/results.json"),
	);
	try {
		const results = readResultsFile(resultsPath);
		const markdown = renderMarkdown(results, {
			allowedVersions: deriveAllowedVersions(results),
		});
		const reportPath = join(resultsPath, "..", "report.md");
		await Bun.write(reportPath, markdown);
		appendStepSummary(markdown);
		console.log(`Wrote ${reportPath}.`);
		return 0;
	} catch (error) {
		if (error instanceof UsageError) {
			console.error(`${error.message}\n`);
			console.error(USAGE);
			return 2;
		}
		throw error;
	}
}

export async function main(argv: string[]): Promise<number> {
	if (argv.includes("--version")) {
		console.log(await readVersion());
		return 0;
	}
	if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
		console.log(USAGE);
		return 0;
	}
	const [command, ...rest] = argv as [string, ...string[]];
	if (command === "init") {
		return cmdInit(rest);
	}
	if (command === "validate") {
		if (rest.length > 0) {
			console.error(`validate takes no arguments.\n`);
			console.error(USAGE);
			return 2;
		}
		return cmdValidate();
	}
	if (command === "run") {
		return cmdRun(rest);
	}
	if (command === "report") {
		return cmdReport(rest);
	}
	console.error(`Unknown arguments: ${argv.join(" ")}\n`);
	console.error(USAGE);
	return 2;
}
