// Find, parse and validate `.opencode-ci/config.*` + scenarios/*. Fail closed:
// any schema or layout problem throws ConfigError (exit 2 upstream).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as YAML from "yaml";
import type { z } from "zod";
import {
	type Config,
	ConfigSchema,
	type Scenario,
	ScenarioSchema,
} from "./schema.ts";

/** Thrown for every config/layout problem. The CLI maps it to exit 2. */
export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigError";
	}
}

export interface LoadResult {
	config: Config;
	scenarios: Scenario[];
	/** Absolute path of the config file, if one existed. */
	configPath?: string;
	warnings: string[];
}

/** Format zod issues with the file path, one issue per line. */
export function formatIssues(file: string, error: z.ZodError): string {
	const lines = error.issues.map((issue) => {
		const at =
			issue.path.length > 0 ? ` at "${String(issue.path.join("."))}"` : "";
		return `  -${at}: ${issue.message}`;
	});
	return `${file}: validation failed:\n${lines.join("\n")}`;
}

/** Extract a "line N" hint from a YAML parse error, when it has one. */
function yamlLineHint(error: unknown): string {
	if (
		error !== null &&
		typeof error === "object" &&
		"linePos" in error &&
		Array.isArray((error as { linePos?: unknown }).linePos) &&
		((error as { linePos: Array<{ line?: unknown }> }).linePos[0]?.line ??
			undefined) !== undefined
	) {
		const line = (error as { linePos: Array<{ line: unknown }> }).linePos[0]
			?.line;
		return ` (line ${String(line)})`;
	}
	const message = error instanceof Error ? error.message : String(error);
	const m = /line (\d+)/i.exec(message);
	return m ? ` (line ${m[1]})` : "";
}

function parseDoc(file: string, text: string): unknown {
	if (file.endsWith(".json")) {
		try {
			return JSON.parse(text) as unknown;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new ConfigError(`${file}: invalid JSON: ${message}`);
		}
	}
	try {
		return YAML.parse(text) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new ConfigError(
			`${file}: invalid YAML${yamlLineHint(error)}: ${message}`,
		);
	}
}

const CONFIG_DIR = ".opencode-ci";
const CONFIG_YAML = join(CONFIG_DIR, "config.yaml");
const CONFIG_JSON = join(CONFIG_DIR, "config.json");
const SCENARIOS_DIR = join(CONFIG_DIR, "scenarios");

export function loadConfig(cwd: string = process.cwd()): {
	config: Config;
	configPath?: string;
	warnings: string[];
} {
	const yamlPath = join(cwd, CONFIG_YAML);
	const jsonPath = join(cwd, CONFIG_JSON);
	const hasYaml = existsSync(yamlPath);
	const hasJson = existsSync(jsonPath);
	if (hasYaml && hasJson) {
		throw new ConfigError(
			`Both ${yamlPath} and ${jsonPath} exist: keep exactly one config file.`,
		);
	}
	if (!hasYaml && !hasJson) {
		const warnings = [
			`No ${CONFIG_YAML} or ${CONFIG_JSON} found under ${cwd}: using defaults.`,
		];
		for (const w of warnings) {
			console.warn(w);
		}
		return { config: ConfigSchema.parse({}), warnings };
	}
	const configPath = hasYaml ? yamlPath : jsonPath;
	const doc = parseDoc(configPath, readFileSync(configPath, "utf8"));
	const parsed = ConfigSchema.safeParse(doc);
	if (!parsed.success) {
		throw new ConfigError(formatIssues(configPath, parsed.error));
	}
	return { config: parsed.data, configPath, warnings: [] };
}

const SCENARIO_EXTS = new Set([".yaml", ".yml", ".json"]);

function isScenarioFile(name: string): boolean {
	const dot = name.lastIndexOf(".");
	if (dot < 0) {
		return false;
	}
	return SCENARIO_EXTS.has(name.slice(dot).toLowerCase());
}

export function loadScenarios(cwd: string = process.cwd()): Scenario[] {
	const dir = join(cwd, SCENARIOS_DIR);
	if (!existsSync(dir)) {
		return [];
	}
	const names = readdirSync(dir).filter(isScenarioFile).sort();
	const scenarios: Scenario[] = [];
	const seen = new Map<string, string>();
	for (const name of names) {
		const file = join(dir, name);
		const doc = parseDoc(file, readFileSync(file, "utf8"));
		const parsed = ScenarioSchema.safeParse(doc);
		if (!parsed.success) {
			throw new ConfigError(formatIssues(file, parsed.error));
		}
		const prev = seen.get(parsed.data.id);
		if (prev !== undefined) {
			throw new ConfigError(
				`${file}: duplicate scenario id "${parsed.data.id}" (already defined in ${prev}).`,
			);
		}
		seen.set(parsed.data.id, file);
		scenarios.push(parsed.data);
	}
	return scenarios;
}

/** Load config + scenarios together. */
export function loadAll(cwd: string = process.cwd()): LoadResult {
	const { config, configPath, warnings } = loadConfig(cwd);
	const scenarios = loadScenarios(cwd);
	return { config, scenarios, configPath, warnings };
}
