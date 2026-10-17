// Parse probe.jsonl into typed records plus the post-phase inventory.
// The probe writes one JSON object per line; a torn final line (killed run)
// or any other bad line is skipped, never fatal.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface ProbeRecord {
	kind: string;
	phase?: string;
	seq?: number;
	t?: number;
	[key: string]: unknown;
}

export interface InventoryPlugin {
	id?: string;
	source?: unknown;
	status?: string;
	error?: string;
}

export interface ProbeInventory {
	plugins: InventoryPlugin[];
	tools: string[];
	commands: string[];
	agents: string[];
	skills: string[];
	mcp: string[];
}

export interface ToolCallPair {
	tool: string;
	callID?: unknown;
	input?: unknown;
	status?: string;
	result?: unknown;
	error?: unknown;
}

/**
 * True when a tool.after `result` embeds non-empty Code Mode inner calls.
 * The execute result nests them (observed shape:
 * result.metadata.metadata.toolCalls), so walk defensively instead of
 * assuming one exact path.
 */
function hasInnerCalls(value: unknown, depth = 0): boolean {
	if (value === null || typeof value !== "object") {
		return false;
	}
	if (depth > 8) {
		return false;
	}
	if (Array.isArray(value)) {
		return value.some((item) => hasInnerCalls(item, depth + 1));
	}
	const record = value as Record<string, unknown>;
	if (
		Array.isArray(record.toolCalls) &&
		(record.toolCalls as unknown[]).length > 0
	) {
		return true;
	}
	return Object.values(record).some((item) => hasInnerCalls(item, depth + 1));
}

export class ProbeLog {
	readonly records: ProbeRecord[];
	readonly inventory?: ProbeInventory;

	constructor(records: ProbeRecord[]) {
		this.records = records;
		// The post probe writes exactly one inventory record; take the last
		// one if several runs ever share a file.
		const found = [...records]
			.reverse()
			.find((record) => record.kind === "inventory");
		if (found !== undefined) {
			this.inventory = {
				plugins: Array.isArray(found.plugins)
					? (found.plugins as InventoryPlugin[])
					: [],
				tools: Array.isArray(found.tools) ? (found.tools as string[]) : [],
				commands: Array.isArray(found.commands)
					? (found.commands as string[])
					: [],
				agents: Array.isArray(found.agents) ? (found.agents as string[]) : [],
				skills: Array.isArray(found.skills) ? (found.skills as string[]) : [],
				mcp: Array.isArray(found.mcp) ? (found.mcp as string[]) : [],
			};
		}
	}

	byKind(kind: string, phase?: string): ProbeRecord[] {
		return this.records.filter(
			(record) =>
				record.kind === kind && (phase === undefined || record.phase === phase),
		);
	}

	/**
	 * Pair tool.before with tool.after by callID. The outer `execute` call
	 * is excluded when it carries inner Code Mode calls: assertions must see
	 * the real inner tool, not the wrapper. A bare `execute` with no inner
	 * calls is kept.
	 */
	toolCalls(phase = "post"): ToolCallPair[] {
		const befores = new Map<unknown, ProbeRecord>();
		for (const record of this.byKind("tool.before", phase)) {
			befores.set(record.callID, record);
		}
		const paired: { pair: ToolCallPair; seq: number }[] = [];
		for (const record of this.byKind("tool.after", phase)) {
			const before = befores.get(record.callID);
			if (before === undefined) {
				continue;
			}
			const tool = String(before.tool ?? record.tool ?? "");
			if (tool === "execute" && hasInnerCalls(record.result)) {
				continue;
			}
			paired.push({
				pair: {
					tool,
					callID: record.callID,
					input: before.input,
					status: typeof record.status === "string" ? record.status : undefined,
					result: record.result,
					error: record.error,
				},
				seq: typeof record.seq === "number" ? record.seq : 0,
			});
		}
		paired.sort((a, b) => a.seq - b.seq);
		return paired.map((entry) => entry.pair);
	}
}

export function readProbe(file: string): ProbeLog {
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return new ProbeLog([]);
	}
	const records: ProbeRecord[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "") {
			continue;
		}
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (parsed !== null && typeof parsed === "object") {
				records.push(parsed as ProbeRecord);
			}
		} catch {
			// Skip bad lines defensively: a torn final line must not fail the run.
		}
	}
	return new ProbeLog(records);
}

/** Absolute directories of the shipped pre/post probe plugins. */
export function probePluginDirs(): { pre: string; post: string } {
	return {
		pre: fileURLToPath(new URL("../../probe/pre", import.meta.url)),
		post: fileURLToPath(new URL("../../probe/post", import.meta.url)),
	};
}
