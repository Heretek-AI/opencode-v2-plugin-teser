// Config + scenario schemas (zod v4). Every object is `.strict()` so typos
// fail validation instead of silently passing (SPEC 5.1, 5.2).
import { z } from "zod";

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SCENARIO_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const versionSchema = z.union([
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
		providers: stringArray(),
		models: stringArray(),
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
		window: z.number().int().positive().default(5),
		threshold: z.number().min(0).max(1).default(0.9),
		bootstrap: z.enum(["fail", "allow"]).default("fail"),
		workflow: z.string().min(1).optional(),
		// Artifact name the gate downloads history from. Must match the
		// `artifact-name` input of the GitHub Action (M13); matrix users
		// set a distinct name per leg here and there.
		artifact: z.string().min(1).default("opencode-plugin-ci-results"),
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
		judgeReply: z.string().optional(),
		timeoutMs: z.number().int().positive().default(120_000),
		expect: scenarioExpectSchema.prefault({}),
		judge: judgeSchema.optional(),
	})
	.strict()
	.superRefine((val, ctx) => {
		const tag = `scenario "${val.id}"`;
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
		if (val.mode === "live" && val.judgeReply !== undefined) {
			ctx.addIssue({
				code: "custom",
				path: ["judgeReply"],
				message: `${tag}: field "judgeReply" is scripted-only and is not allowed when mode is "live"`,
			});
		}
	});

export type Scenario = z.infer<typeof ScenarioSchema>;
