// Judge: a plugin-free, tool-less second `opencode run` that grades recorded
// evidence against a rubric (SPEC 6.3, M11). It runs only for live scenarios
// with `judge.rubric`, and only after the deterministic checks passed for an
// attempt. Judge tokens count toward the live budget.
//
// Testing hook: when `OPENCODE_PLUGIN_CI_JUDGE_VIA_STUB=1` is set, the judge
// run uses the stub model instead of the live model. This exists only so the
// judge path is exercisable offline in tests; production runs never set it.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { textOf, usage } from "../opencode/events.ts";
import { Sandbox } from "../sandbox/sandbox.ts";
import { JUDGE_SENTINEL, startStub } from "../stub/stub.ts";

export { JUDGE_SENTINEL };

export const JUDGE_SYSTEM =
	"You grade whether recorded evidence satisfies a rubric. You cannot run tools. Be strict: if the evidence does not clearly show the rubric is met, fail it.";

export const JUDGE_AGENT = "opencode-plugin-ci-judge";

export interface JudgeEvidenceSections {
	rubric: string;
	text?: string;
	toolCalls?: string;
	hookSummary?: string;
	files?: string;
}

export interface Verdict {
	pass: boolean;
	reason: string;
}

const SECTION_LIMIT = 8000;

function clip(section: string): string {
	if (section.length <= SECTION_LIMIT) {
		return section;
	}
	return `${section.slice(0, SECTION_LIMIT)}…[+${section.length - SECTION_LIMIT} chars]`;
}

/**
 * Build the judge prompt. The first line is the sentinel (so the stub can
 * classify judge requests), then the rubric, then the non-empty evidence
 * sections each truncated to 8000 chars, then the reply contract.
 */
export function buildJudgePrompt(sections: JudgeEvidenceSections): string {
	const parts: string[] = [JUDGE_SENTINEL, `Rubric:\n${sections.rubric}`];
	if (sections.text !== undefined && sections.text.length > 0) {
		parts.push(`Evidence: model text\n${clip(sections.text)}`);
	}
	if (sections.toolCalls !== undefined && sections.toolCalls.length > 0) {
		parts.push(`Evidence: tool calls\n${clip(sections.toolCalls)}`);
	}
	if (sections.hookSummary !== undefined && sections.hookSummary.length > 0) {
		parts.push(`Evidence: hook summary\n${clip(sections.hookSummary)}`);
	}
	if (sections.files !== undefined && sections.files.length > 0) {
		parts.push(`Evidence: files\n${clip(sections.files)}`);
	}
	parts.push(
		'Reply with exactly one JSON object: {"pass": true|false, "reason": "<one sentence>"} and nothing else.',
	);
	return parts.join("\n\n");
}

function invalidVerdict(reply: string): Verdict {
	return {
		pass: false,
		reason: `judge reply was not valid JSON: ${reply.slice(0, 200)}`,
	};
}

/**
 * Parse the judge verdict from the run's text. Takes the first balanced
 * `{…}` block (respecting double-quoted strings), JSON.parses it, and
 * requires `pass` to be a boolean and `reason` to be a string. Anything
 * else is a failed judgement.
 */
export function parseVerdict(reply: string): Verdict {
	const start = reply.indexOf("{");
	if (start === -1) {
		return invalidVerdict(reply);
	}
	let depth = 0;
	let inString = false;
	let escaped = false;
	let end = -1;
	for (let i = start; i < reply.length; i++) {
		const ch = reply[i] as string;
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
		} else if (ch === "{") {
			depth += 1;
		} else if (ch === "}") {
			depth -= 1;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	if (end === -1) {
		return invalidVerdict(reply);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(reply.slice(start, end + 1));
	} catch {
		return invalidVerdict(reply);
	}
	if (
		parsed !== null &&
		typeof parsed === "object" &&
		typeof (parsed as { pass?: unknown }).pass === "boolean" &&
		typeof (parsed as { reason?: unknown }).reason === "string"
	) {
		const { pass, reason } = parsed as { pass: boolean; reason: string };
		return { pass, reason };
	}
	return invalidVerdict(reply);
}

export interface RunJudgeOptions {
	rubric: string;
	/** Live model (`provider/model`); overridden by `judgeModel`. */
	model: string;
	/** Per-scenario judge model override (`scenario.judge.model`). */
	judgeModel?: string;
	opencodeBin: string;
	/** Live API keys, passed into the sandbox env (never logged). */
	env?: Record<string, string>;
	/** When set, the prompt, events and stderr are written here. */
	evidenceDir?: string;
	logLevel?: "info" | "all";
	timeoutMs?: number;
	text?: string;
	toolCalls?: string;
	hookSummary?: string;
	files?: string;
	/** Reply text when running via the stub test hook. */
	stubReply?: string;
}

export interface JudgeOutcome {
	verdict: Verdict;
	costUSD: number;
	tokens: { input: number; output: number };
	rawText: string;
}

/**
 * Run the judge: one `opencode run` with no plugins and a deny-all agent,
 * then parse the verdict. Returns the verdict plus the token cost (which the
 * caller adds to the live budget). Never throws for judge failures; only
 * for sandbox crashes.
 */
export async function runJudge(opts: RunJudgeOptions): Promise<JudgeOutcome> {
	const prompt = buildJudgePrompt({
		rubric: opts.rubric,
		text: opts.text,
		toolCalls: opts.toolCalls,
		hookSummary: opts.hookSummary,
		files: opts.files,
	});
	const agents = {
		[JUDGE_AGENT]: {
			mode: "primary",
			description: "Grades recorded evidence",
			system: JUDGE_SYSTEM,
			permissions: [{ action: "*", resource: "*", effect: "deny" }],
		},
	};
	const timeoutMs = opts.timeoutMs ?? 120_000;

	// Hidden test hook: grade via the stub so the judge path works offline.
	// Production runs never set this env var.
	if (process.env.OPENCODE_PLUGIN_CI_JUDGE_VIA_STUB === "1") {
		const stub = await startStub({
			script: [],
			judgeReply:
				opts.stubReply ?? '{"pass":false,"reason":"no stubReply given"}',
		});
		const sandbox = new Sandbox({
			opencodeBin: opts.opencodeBin,
			stubUrl: stub.url,
			plugins: [],
			agents,
			logLevel: opts.logLevel ?? "info",
		});
		try {
			const run = await sandbox.run(prompt, {
				agent: JUDGE_AGENT,
				auto: false,
				timeoutMs,
			});
			writeJudgeEvidence(opts.evidenceDir, prompt, run.events, run.stderr);
			const rawText = textOf(run.events);
			if (run.timedOut) {
				return {
					verdict: {
						pass: false,
						reason: `judge run timed out after ${timeoutMs}ms.`,
					},
					costUSD: usage(run.events).cost,
					tokens: { input: 0, output: 0 },
					rawText,
				};
			}
			const used = usage(run.events);
			return {
				verdict: parseVerdict(rawText),
				costUSD: used.cost,
				tokens: { input: used.input, output: used.output },
				rawText,
			};
		} finally {
			await sandbox.dispose();
			await stub.stop();
		}
	}

	const sandbox = new Sandbox({
		opencodeBin: opts.opencodeBin,
		liveModel: opts.judgeModel ?? opts.model,
		plugins: [],
		agents,
		env: opts.env,
		logLevel: opts.logLevel ?? "info",
	});
	const run = await sandbox.run(prompt, {
		agent: JUDGE_AGENT,
		auto: false,
		timeoutMs,
	});
	try {
		writeJudgeEvidence(opts.evidenceDir, prompt, run.events, run.stderr);
		const rawText = textOf(run.events);
		if (run.timedOut) {
			return {
				verdict: {
					pass: false,
					reason: `judge run timed out after ${timeoutMs}ms.`,
				},
				costUSD: usage(run.events).cost,
				tokens: { input: 0, output: 0 },
				rawText,
			};
		}
		const used = usage(run.events);
		return {
			verdict: parseVerdict(rawText),
			costUSD: used.cost,
			tokens: { input: used.input, output: used.output },
			rawText,
		};
	} finally {
		await sandbox.dispose();
	}
}

function writeJudgeEvidence(
	evidenceDir: string | undefined,
	prompt: string,
	events: { type: string }[],
	stderr: string,
): void {
	if (evidenceDir === undefined) {
		return;
	}
	const dir = resolve(evidenceDir);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "judge-prompt.txt"), `${prompt}\n`);
	writeFileSync(
		join(dir, "judge-events.jsonl"),
		events.map((e) => JSON.stringify(e)).join("\n") +
			(events.length > 0 ? "\n" : ""),
	);
	writeFileSync(join(dir, "judge-stderr.log"), stderr);
}
