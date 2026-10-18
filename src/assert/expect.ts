// Evaluate a scenario `expect` block against recorded evidence.
// Every failed assertion becomes a human-readable string ([] = pass).
// Fail closed: missing records, missing files, and unparseable bodies are
// failures, never silent passes.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { Matcher, ScenarioExpect } from "../config/schema.ts";
import { errors, textOf, toolUses } from "../opencode/events.ts";
import type { ProbeLog, ProbeRecord } from "../probe/read.ts";
import type { RunOutput } from "../sandbox/sandbox.ts";
import {
	allMessageText,
	catalogPaths,
	text as messageText,
	pathSegments,
} from "../stub/codemode.ts";
import type { Recorded } from "../stub/stub.ts";
import { check } from "./matchers.ts";

export interface Evidence {
	run: RunOutput;
	probe: ProbeLog;
	stubRequests: Recorded[];
	projectDir: string;
	mode: "scripted" | "live";
}

/** Output text of one probe tool call: content joined, else output, else JSON. */
export function getOutputText(result: unknown): string {
	if (result === undefined || result === null) {
		return "";
	}
	if (typeof result === "string") {
		return result;
	}
	if (typeof result !== "object") {
		return String(result);
	}
	const record = result as Record<string, unknown>;
	if (typeof record.content === "string") {
		return record.content;
	}
	if (Array.isArray(record.content)) {
		return record.content
			.map((item) => {
				if (typeof item === "string") {
					return item;
				}
				if (item !== null && typeof item === "object") {
					const text = (item as Record<string, unknown>).text;
					if (typeof text === "string") {
						return text;
					}
				}
				try {
					return JSON.stringify(item) ?? "";
				} catch {
					return String(item);
				}
			})
			.join("\n");
	}
	if (typeof record.output === "string") {
		return record.output;
	}
	if (record.output !== undefined) {
		try {
			return JSON.stringify(record.output) ?? "";
		} catch {
			return String(record.output);
		}
	}
	try {
		return JSON.stringify(result) ?? "";
	} catch {
		return String(result);
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

/** Direct tool names from a chat request's `tools` array. */
function directToolNames(body: unknown): string[] {
	const tools = (body as { tools?: unknown } | null | undefined)?.tools;
	if (!Array.isArray(tools)) {
		return [];
	}
	const names: string[] = [];
	for (const tool of tools) {
		const name = (tool as { function?: { name?: unknown } } | null | undefined)
			?.function?.name;
		if (typeof name === "string") {
			names.push(name);
		}
	}
	return names;
}

/** Text of system-role messages only (SPEC: request.system is system text). */
function systemTextOf(body: unknown): string {
	const messages = (body as { messages?: unknown } | null | undefined)
		?.messages;
	if (!Array.isArray(messages)) {
		return "";
	}
	const parts: string[] = [];
	for (const message of messages) {
		if (
			message === null ||
			typeof message !== "object" ||
			(message as { role?: unknown }).role !== "system"
		) {
			continue;
		}
		parts.push(messageText((message as { content?: unknown }).content ?? ""));
	}
	return parts.filter((part) => part.length > 0).join("\n");
}

/**
 * Tools a request offered: direct names plus every catalog path's last
 * segment and `_`-joined form (the hook effective-name form, e.g.
 * `opencode_session_rename`).
 */
function requestToolNames(body: unknown): string[] {
	const names = new Set(directToolNames(body));
	for (const path of catalogPaths(allMessageText(body))) {
		const segments = pathSegments(path);
		if (segments.length === 0) {
			continue;
		}
		const last = segments.at(-1);
		if (last !== undefined) {
			names.add(last);
		}
		names.add(segments.join("_"));
	}
	return [...names];
}

/**
 * Canonical tool name for comparisons. Hooks record a namespaced tool under
 * its effective name `<namespace>_<name>` (dots in the namespace become
 * underscores), while catalogs and `tool_use` inner calls use dots
 * (`tools.ns.my_tool`, `ns.my_tool`). Joining the segments with `_` maps all
 * of those to the effective name.
 */
export function normalizeToolName(name: string): string {
	const segments =
		name.startsWith("tools.") || name.startsWith("tools[")
			? pathSegments(name)
			: name.split(".");
	return segments.join("_");
}

/** Recorded names that end in `_<wanted>`: likely the namespaced form the author meant. */
function namespacedHints(recorded: string[], wanted: string): string[] {
	const suffix = `_${normalizeToolName(wanted)}`;
	return [...new Set(recorded.filter((name) => name.endsWith(suffix)))];
}

const HOOK_KINDS: Record<string, string> = {
	"tool.execute.before": "tool.before",
	"tool.execute.after": "tool.after",
	"shell.create.before": "shell.before",
	"session.context": "session.context",
	"session.prompt": "session.prompt",
};

function evaluateTools(expect: ScenarioExpect, ev: Evidence): string[] {
	const failures: string[] = [];
	const wanted = expect.tools ?? [];
	wanted.forEach((tool, index) => {
		const label = `tools[${index}].${tool.name}`;
		const recorded = ev.probe.toolCalls("post");
		const calls = recorded.filter(
			(call) => normalizeToolName(call.tool) === normalizeToolName(tool.name),
		);
		failures.push(
			...check(calls.length, { count: tool.count ?? { gte: 1 } }, label),
		);
		if (calls.length === 0) {
			const hints = namespacedHints(
				recorded.map((call) => call.tool),
				tool.name,
			);
			if (hints.length > 0) {
				failures.push(
					`${label}: namespaced tools are recorded as <namespace>_<name>; did you mean ${hints.join(" or ")}?`,
				);
			}
			return;
		}
		const perCall = calls.map((call) => {
			const sub: string[] = [];
			if (tool.status !== undefined && call.status !== tool.status) {
				sub.push(
					`${label}: expected status ${JSON.stringify(tool.status)}, got ${JSON.stringify(call.status ?? "?")}.`,
				);
			}
			const input = asRecord(call.input);
			for (const [key, matcher] of Object.entries(tool.input ?? {})) {
				sub.push(...check(input[key], matcher, `${label}.input.${key}`));
			}
			if (tool.output !== undefined) {
				sub.push(
					...check(getOutputText(call.result), tool.output, `${label}.output`),
				);
			}
			return sub;
		});
		if (perCall.every((sub) => sub.length > 0)) {
			failures.push(
				`${label}: ${calls.length} call(s) recorded, but none matched status/input/output together.`,
			);
			failures.push(...(perCall[0] ?? []));
		}
	});
	for (const name of expect.noTools ?? []) {
		const probeNames = ev.probe.toolCalls("post").map((call) => call.tool);
		const eventNames = toolUses(ev.run.events).flatMap((use) => [
			use.tool,
			...use.innerCalls.map((inner) => inner.tool),
		]);
		const wanted = normalizeToolName(name);
		if (
			[...probeNames, ...eventNames].some(
				(called) => normalizeToolName(called) === wanted,
			)
		) {
			failures.push(
				`noTools: expected tool ${JSON.stringify(name)} not to be called, but it was.`,
			);
		}
	}
	return failures;
}

function evaluateHooks(expect: ScenarioExpect, ev: Evidence): string[] {
	const failures: string[] = [];
	(expect.hooks ?? []).forEach((hook, index) => {
		const kind = HOOK_KINDS[hook.hook] ?? hook.hook;
		const label = `hooks[${index}].${hook.hook}@${hook.phase}`;
		let candidates = ev.probe.byKind(kind, hook.phase);
		if (hook.tool !== undefined) {
			const wanted = normalizeToolName(hook.tool);
			candidates = candidates.filter(
				(record) => normalizeToolName(String(record.tool ?? "")) === wanted,
			);
		}
		if (candidates.length === 0) {
			failures.push(
				`${label}: expected at least one matching record, got none.`,
			);
			return;
		}
		const perRecord = candidates.map((record) =>
			matchHookRecord(record, hook, label),
		);
		if (perRecord.every((sub) => sub.length > 0)) {
			failures.push(`${label}: no record matched all matchers.`);
			failures.push(...(perRecord[0] ?? []));
		}
	});
	return failures;
}

function matchHookRecord(
	record: ProbeRecord,
	hook: {
		hook: string;
		input?: Record<string, Matcher>;
		env?: Record<string, Matcher>;
		system?: Matcher;
	},
	label: string,
): string[] {
	const failures: string[] = [];
	const inputMatchers = hook.input ?? {};
	const envMatchers = hook.env ?? {};
	if (
		hook.hook === "tool.execute.before" ||
		hook.hook === "tool.execute.after"
	) {
		const input = asRecord(record.input);
		for (const [key, matcher] of Object.entries(inputMatchers)) {
			failures.push(...check(input[key], matcher, `${label}.input.${key}`));
		}
	} else {
		for (const [key, matcher] of Object.entries(inputMatchers)) {
			failures.push(...check(record[key], matcher, `${label}.input.${key}`));
		}
	}
	if (Object.keys(envMatchers).length > 0) {
		const env = asRecord(record.env);
		for (const [key, matcher] of Object.entries(envMatchers)) {
			failures.push(...check(env[key], matcher, `${label}.env.${key}`));
		}
	}
	if (hook.system !== undefined) {
		if (hook.hook !== "session.context") {
			failures.push(
				`${label}.system: system matcher only applies to session.context.`,
			);
		} else {
			const system = record.system;
			const text = Array.isArray(system)
				? system
						.map((part) =>
							typeof part === "string" ? part : (JSON.stringify(part) ?? ""),
						)
						.join("\n")
				: typeof system === "string"
					? system
					: "";
			failures.push(...check(text, hook.system, `${label}.system`));
		}
	}
	return failures;
}

function evaluateRequest(expect: ScenarioExpect, ev: Evidence): string[] {
	const failures: string[] = [];
	const wanted = expect.request;
	if (wanted === undefined) {
		return failures;
	}
	const primaries = ev.stubRequests.filter((r) => r.kind === "primary");
	const nth = wanted.nth ?? 1;
	const record = primaries[nth - 1];
	if (record === undefined) {
		failures.push(
			`request: expected at least ${nth} primary request(s), got ${primaries.length}.`,
		);
		return failures;
	}
	if (wanted.system !== undefined) {
		failures.push(
			...check(systemTextOf(record.body), wanted.system, "request.system"),
		);
	}
	if (wanted.tools !== undefined) {
		failures.push(
			...check(requestToolNames(record.body), wanted.tools, "request.tools"),
		);
	}
	return failures;
}

function evaluateFiles(expect: ScenarioExpect, ev: Evidence): string[] {
	const failures: string[] = [];
	const base = resolve(ev.projectDir);
	(expect.files ?? []).forEach((file, index) => {
		const label = `files[${index}].${file.path}`;
		const absolute = resolve(base, file.path);
		if (absolute !== base && !absolute.startsWith(base + sep)) {
			failures.push(`${label}: path escapes the project dir.`);
			return;
		}
		// OCI-2.5-files-symlink: the lexical check above is blind to symlinks
		// (e.g. `linketc -> /etc` makes `linketc/passwd` read host files into
		// `got` failure strings). Resolve the real path — the file itself when
		// present, else its parent plus the final segment — and re-check
		// containment. Fail closed on any realpath error.
		try {
			const baseReal = realpathSync(base);
			// Nearest existing ancestor (the file itself when present), so
			// assertions on not-yet-created files still resolve; then re-append
			// the missing tail segments.
			let cur = absolute;
			const tail: string[] = [];
			for (;;) {
				if (existsSync(cur)) {
					break;
				}
				const parent = dirname(cur);
				if (parent === cur) {
					break;
				}
				tail.unshift(basename(cur));
				cur = parent;
			}
			const resolved = join(realpathSync(cur), ...tail);
			if (resolved !== baseReal && !resolved.startsWith(baseReal + sep)) {
				failures.push(
					`${label}: path escapes the project dir (symlink target outside).`,
				);
				return;
			}
		} catch {
			failures.push(
				`${label}: path escapes the project dir (could not resolve real path).`,
			);
			return;
		}
		const present = existsSync(absolute);
		if (file.exists !== undefined) {
			if (file.exists && !present) {
				failures.push(`${label}: expected file to exist, but it does not.`);
				return;
			}
			if (!file.exists && present) {
				failures.push(`${label}: expected file not to exist, but it does.`);
				return;
			}
		}
		const needsContent =
			file.contains !== undefined ||
			file.notContains !== undefined ||
			file.matches !== undefined;
		if (!present) {
			if (needsContent || file.exists === undefined) {
				failures.push(`${label}: file not found.`);
			}
			return;
		}
		let content: string;
		try {
			content = readFileSync(absolute, "utf8");
		} catch (error) {
			failures.push(
				`${label}: could not read file: ${error instanceof Error ? error.message : String(error)}.`,
			);
			return;
		}
		if (file.contains !== undefined) {
			failures.push(...check(content, { contains: file.contains }, label));
		}
		if (file.notContains !== undefined) {
			failures.push(
				...check(content, { notContains: file.notContains }, label),
			);
		}
		if (file.matches !== undefined) {
			failures.push(...check(content, { matches: file.matches }, label));
		}
	});
	return failures;
}

export function evaluate(expect: ScenarioExpect, ev: Evidence): string[] {
	const failures: string[] = [];

	if (ev.run.code !== (expect.exitCode ?? 0)) {
		failures.push(
			`expected exit code ${expect.exitCode ?? 0}, got ${ev.run.code}.`,
		);
	}
	if ((expect.noErrors ?? true) && errors(ev.run.events).length > 0) {
		const first = errors(ev.run.events)[0]?.error;
		failures.push(
			`opencode reported ${errors(ev.run.events).length} error event(s)` +
				(first?.message ? `: ${first.message}.` : "."),
		);
	}

	failures.push(...evaluateTools(expect, ev));
	failures.push(...evaluateHooks(expect, ev));
	failures.push(...evaluateRequest(expect, ev));
	failures.push(...evaluateFiles(expect, ev));

	if (expect.text !== undefined) {
		failures.push(...check(textOf(ev.run.events), expect.text, "text"));
	}
	if (expect.stderr !== undefined) {
		failures.push(...check(ev.run.stderr, expect.stderr, "stderr"));
	}
	return failures;
}
