// Typed view of `opencode run --format json` stdout (one JSON object per line).
// Shapes confirmed against opencode 2.0.26 (IMPLEMENTATION_PROMPT section 2.1).

export interface InnerToolCall {
	tool: string;
	status: string;
	input?: unknown;
	output?: unknown;
	error?: unknown;
}

export interface ToolCallState {
	status: string;
	input?: unknown;
	output?: unknown;
	error?: unknown;
	metadata?: {
		metadata?: {
			toolCalls?: InnerToolCall[];
		};
	};
}

export interface StepTokens {
	input?: number;
	output?: number;
	reasoning?: number;
	cache?: {
		read?: number;
		write?: number;
	};
}

export interface RunEventPart {
	type: string;
	id?: string;
	tool?: string;
	text?: string;
	reason?: string;
	cost?: number;
	tokens?: StepTokens;
	state?: ToolCallState;
}

export interface RunEventError {
	type?: string;
	message?: string;
	status?: number;
	response?: unknown;
}

export interface RunEvent {
	type: string;
	timestamp?: string;
	sessionID?: string;
	part?: RunEventPart;
	error?: RunEventError;
}

export interface ToolUse {
	tool: string;
	status: string;
	input?: unknown;
	output?: unknown;
	error?: unknown;
	innerCalls: InnerToolCall[];
}

export interface Usage {
	cost: number;
	input: number;
	output: number;
}

export function parseEventsCounted(stdout: string): {
	events: RunEvent[];
	skipped: number;
} {
	const events: RunEvent[] = [];
	let skipped = 0;
	for (const line of stdout.split("\n")) {
		if (!line.startsWith("{")) {
			continue;
		}
		try {
			events.push(JSON.parse(line) as RunEvent);
		} catch {
			skipped += 1;
		}
	}
	return { events, skipped };
}

export function parseEvents(stdout: string): RunEvent[] {
	return parseEventsCounted(stdout).events;
}

// All `text` part payloads joined with newline.
export function textOf(events: RunEvent[]): string {
	const texts: string[] = [];
	for (const event of events) {
		if (event.part?.type === "text" && typeof event.part.text === "string") {
			texts.push(event.part.text);
		}
	}
	return texts.join("\n");
}

// One entry per `tool` part. Inner Code Mode calls come from
// state.metadata.metadata.toolCalls (empty when there are none).
export function toolUses(events: RunEvent[]): ToolUse[] {
	const uses: ToolUse[] = [];
	for (const event of events) {
		if (event.part?.type !== "tool" || typeof event.part.tool !== "string") {
			continue;
		}
		uses.push({
			tool: event.part.tool,
			status: event.part.state?.status ?? "?",
			input: event.part.state?.input,
			output: event.part.state?.output,
			error: event.part.state?.error,
			innerCalls: event.part.state?.metadata?.metadata?.toolCalls ?? [],
		});
	}
	return uses;
}

export function errors(events: RunEvent[]): RunEvent[] {
	return events.filter((event) => event.type === "error");
}

// Sums cost and token input/output over step_finish parts.
export function usage(events: RunEvent[]): Usage {
	let cost = 0;
	let input = 0;
	let output = 0;
	for (const event of events) {
		if (event.part?.type !== "step-finish") {
			continue;
		}
		cost += event.part.cost ?? 0;
		input += event.part.tokens?.input ?? 0;
		output += event.part.tokens?.output ?? 0;
	}
	return { cost, input, output };
}
