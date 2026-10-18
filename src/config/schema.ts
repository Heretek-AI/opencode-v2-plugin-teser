// Config + scenario schemas (zod v4). Every object is `.strict()` so typos
// fail validation instead of silently passing (SPEC 5.1, 5.2).
import { isAbsolute } from "node:path";
import { z } from "zod";
import { DEFAULT_RESULTS_ARTIFACT } from "../gate/history.ts";

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SCENARIO_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
// Case ids the runner itself uses: tier 1 ("load") and the escape hatch.
const RESERVED_IDS = ["load", "bun-test"];

export const versionSchema = z.union([
	z.literal("latest"),
	z.string().regex(VERSION_RE, 'must be semver (x.y.z) or "latest"'),
]);

const pluginConfigSchema = z
	.object({
		path: z.string().min(1).default("."),
		entry: z.string().min(1).optional(),
		install: z.string().min(1).optional(),
		build: z.string().min(1).optional(),
		options: z.record(z.string(), z.unknown()).default({}),
		// Absent means auto-detect (server entry present => server, else TUI).
		ui: z.boolean().optional(),
	})
	.strict();

const opencodeConfigSchema = z
	.object({
		versions: z.array(versionSchema).min(1).default(["2.0.26"]),
	})
	.strict();

const stringArray = (fallback: string[] = []) =>
	z.array(z.string()).default(fallback);

const configExpectSchema = z
	.object({
		tools: stringArray(),
		commands: stringArray(),
		agents: stringArray(),
		skills: stringArray(),
		mcp: stringArray(),
	})
	.strict();

const liveConfigSchema = z
	.object({
		model: z.string().min(1).optional(),
		keys: z.array(z.string().min(1)).min(1).default(["OPENCODE_API_KEY"]),
		repeat: z.number().int().positive().default(3),
		pass: z.number().int().positive().default(2),
		budgetUSD: z.number().positive().default(1),
		timeoutMs: z.number().int().positive().default(240_000),
	})
	.strict();

const gateConfigSchema = z
	.object({
		enabled: z.boolean().default(true),
		bootstrap: z.enum(["fail", "allow"]).default("fail"),
		workflow: z.string().min(1).optional(),
		// Artifact name the gate downloads history from. `run --gate-artifact`
		// overrides it; the GitHub Action passes its `artifact-name` input
		// that way, so matrix legs never need per-leg config.
		artifact: z.string().min(1).default(DEFAULT_RESULTS_ARTIFACT),
	})
	.strict();

export const ConfigSchema = z
	.object({
		// prefault (not default): the fallback is parsed, so inner field
		// defaults still apply when the whole block is missing. zod v4's
		// .default() would return the fallback as-is.
		plugin: pluginConfigSchema.prefault({}),
		opencode: opencodeConfigSchema.prefault({}),
		expect: configExpectSchema.prefault({}),
		live: liveConfigSchema.prefault({}),
		gate: gateConfigSchema.prefault({}),
		logLevel: z.enum(["info", "all"]).default("info"),
	})
	.strict()
	.superRefine((val, ctx) => {
		if (val.live.pass > val.live.repeat) {
			ctx.addIssue({
				code: "custom",
				path: ["live", "pass"],
				message: `live.pass (${val.live.pass}) must be <= live.repeat (${val.live.repeat})`,
			});
		}
		// OCI-6.2-artifact-poisoning: matrix legs uploading the same default
		// artifact name collide (upload-artifact merges by name), so allowed
		// `latest` results can poison required-leg gate history. Fail closed
		// when the default name is shared across versions; per-leg distinct
		// names (README matrix example) pass.
		if (
			val.opencode.versions.length > 1 &&
			val.gate.artifact === DEFAULT_RESULTS_ARTIFACT
		) {
			ctx.addIssue({
				code: "custom",
				path: ["gate", "artifact"],
				message:
					`gate.artifact must not be the default ${JSON.stringify(DEFAULT_RESULTS_ARTIFACT)} ` +
					"when opencode.versions has more than one entry: give each matrix leg " +
					"a distinct artifact name (e.g. opencode-plugin-ci-results-2.0.26).",
			});
		}
	});

export type Config = z.infer<typeof ConfigSchema>;

// --- Scenario ---

const countMatcherSchema = z
	.object({
		eq: z.number().optional(),
		gte: z.number().optional(),
		lte: z.number().optional(),
	})
	.strict();

export const MatcherSchema = z
	.object({
		equals: z.unknown().optional(),
		contains: z.unknown().optional(),
		notContains: z.unknown().optional(),
		matches: z.string().min(1).optional(),
		notMatches: z.string().min(1).optional(),
		includes: z.array(z.string()).min(1).optional(),
		exists: z.boolean().optional(),
		count: countMatcherSchema.optional(),
	})
	.strict()
	.superRefine((val, ctx) => {
		if (Object.keys(val).length === 0) {
			ctx.addIssue({
				code: "custom",
				message:
					"matcher must specify at least one of: equals, contains, notContains, matches, notMatches, includes, exists, count",
			});
		}
	});

export type Matcher = z.infer<typeof MatcherSchema>;
export type CountMatcher = z.infer<typeof countMatcherSchema>;

const toolCallSchema = z
	.object({
		name: z.string().min(1),
		arguments: z.record(z.string(), z.unknown()).default({}),
	})
	.strict();

const stepSchema = z
	.object({
		text: z.string().optional(),
		toolCalls: z.array(toolCallSchema).optional(),
		raw: z.boolean().optional(),
	})
	.strict();

export type Step = z.infer<typeof stepSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;

const toolExpectSchema = z
	.object({
		name: z.string().min(1),
		status: z.enum(["completed", "error"]).optional(),
		input: z.record(z.string(), MatcherSchema).optional(),
		output: MatcherSchema.optional(),
		count: countMatcherSchema.optional(),
	})
	.strict();

const hookExpectSchema = z
	.object({
		hook: z.enum([
			"tool.execute.before",
			"tool.execute.after",
			"shell.create.before",
			"session.context",
			"session.prompt",
		]),
		phase: z.enum(["pre", "post"]).default("post"),
		tool: z.string().min(1).optional(),
		input: z.record(z.string(), MatcherSchema).optional(),
		env: z.record(z.string(), MatcherSchema).optional(),
		system: MatcherSchema.optional(),
	})
	.strict();

const requestExpectSchema = z
	.object({
		nth: z.number().int().positive().default(1),
		system: MatcherSchema.optional(),
		tools: MatcherSchema.optional(),
	})
	.strict();

const fileExpectSchema = z
	.object({
		path: z.string().min(1),
		exists: z.boolean().optional(),
		contains: z.string().optional(),
		notContains: z.string().optional(),
		matches: z.string().min(1).optional(),
	})
	.strict();

const scenarioExpectSchema = z
	.object({
		exitCode: z.number().int().default(0),
		noErrors: z.boolean().default(true),
		tools: z.array(toolExpectSchema).optional(),
		noTools: z.array(z.string().min(1)).optional(),
		hooks: z.array(hookExpectSchema).optional(),
		request: requestExpectSchema.optional(),
		files: z.array(fileExpectSchema).optional(),
		stderr: MatcherSchema.optional(),
		text: MatcherSchema.optional(),
	})
	.strict();

export type ScenarioExpect = z.infer<typeof scenarioExpectSchema>;

const judgeSchema = z
	.object({
		rubric: z.string().min(1),
		model: z.string().min(1).optional(),
	})
	.strict();

export const ScenarioSchema = z
	.object({
		id: z.string().regex(SCENARIO_ID_RE, "must match /^[a-z0-9][a-z0-9-]*$/"),
		description: z.string().optional(),
		mode: z.enum(["scripted", "live"]),
		plugin: z
			.object({ options: z.record(z.string(), z.unknown()).optional() })
			.strict()
			.optional(),
		workspace: z.record(z.string(), z.string()).optional(),
		prompt: z.string().min(1),
		script: z.array(stepSchema).optional(),
		// No default here: scripted runs fall back to 120000 and live runs to
		// config.live.timeoutMs, so an unset value must stay distinguishable.
		timeoutMs: z.number().int().positive().optional(),
		expect: scenarioExpectSchema.prefault({}),
		judge: judgeSchema.optional(),
	})
	.strict()
	.superRefine((val, ctx) => {
		const tag = `scenario "${val.id}"`;
		if (RESERVED_IDS.includes(val.id)) {
			ctx.addIssue({
				code: "custom",
				path: ["id"],
				message: `${tag}: id "${val.id}" is reserved (the tool uses it for its own case and evidence dir)`,
			});
		}
		for (const key of Object.keys(val.workspace ?? {})) {
			if (isAbsolute(key) || key.split(/[\\/]/).includes("..")) {
				ctx.addIssue({
					code: "custom",
					path: ["workspace", key],
					message: `${tag}: workspace path "${key}" must be relative and stay inside the project dir`,
				});
			}
		}
		if (val.mode === "scripted" && val.script === undefined) {
			ctx.addIssue({
				code: "custom",
				path: ["script"],
				message: `${tag}: field "script" is required when mode is "scripted"`,
			});
		}
		if (val.mode === "live" && val.script !== undefined) {
			ctx.addIssue({
				code: "custom",
				path: ["script"],
				message: `${tag}: field "script" is forbidden when mode is "live"`,
			});
		}
		if (val.mode === "live" && val.expect.request !== undefined) {
			ctx.addIssue({
				code: "custom",
				path: ["expect", "request"],
				message: `${tag}: field "expect.request" is scripted-only and is not allowed when mode is "live"`,
			});
		}
		if (val.mode === "scripted" && val.judge !== undefined) {
			ctx.addIssue({
				code: "custom",
				path: ["judge"],
				message: `${tag}: field "judge" is live-only and is not allowed when mode is "scripted"`,
			});
		}
	});

export type Scenario = z.infer<typeof ScenarioSchema>;
