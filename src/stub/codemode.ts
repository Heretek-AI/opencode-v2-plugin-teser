// Code Mode catalog parsing + auto-wrap path lookup.
//
// The catalog lives in the request's system text: plugin tools are listed as
// `- tools.<ns>.<name>({...` / `- tools.<ns>["<name>"]...` lines and the model
// calls them through the built-in `execute` tool. The stub rewrites a scripted
// direct tool call into an `execute` call by finding the tool's exact catalog
// path (opencode 2.0.26, see IMPLEMENTATION_PROMPT section 2.5 and NOTES.md).

/** Every `tools.…(` call path listed in a Code Mode catalog. */
export function catalogPaths(text: string): string[] {
	// NOTE: the capture group below includes the trailing "(" (the `\(` sits
	// inside the group in the spec regex). Strip it so the result is a usable
	// call path such as `tools.spike_echo` rather than `tools.spike_echo(`.
	const re =
		/^\s*-\s+(tools(?:\.[A-Za-z_$][\w$]*|\[(?:"[^"]+"|'[^']+')\])+\()/gm;
	return [...text.matchAll(re)].flatMap((m) =>
		m[1] === undefined ? [] : [m[1].replace(/\($/, "")],
	);
}

/** Segments of a path: tools.ns["my-tool"] -> ["ns","my-tool"]. */
export function pathSegments(path: string): string[] {
	let rest = path.trim();
	if (rest === "tools") {
		return [];
	}
	if (rest.startsWith("tools.")) {
		rest = rest.slice("tools".length);
	} else if (rest.startsWith("tools[")) {
		rest = rest.slice("tools".length);
	} else {
		// Not a catalog path at all.
		return [];
	}
	const segments: string[] = [];
	let i = 0;
	while (i < rest.length) {
		const ch = rest[i];
		if (ch === ".") {
			const m = /^[A-Za-z_$][\w$]*/.exec(rest.slice(i + 1));
			if (!m) {
				break;
			}
			segments.push(m[0]);
			i += 1 + m[0].length;
		} else if (ch === "[") {
			const m = /^\[(?:"([^"]+)"|'([^']+)')\]/.exec(rest.slice(i));
			if (!m) {
				break;
			}
			segments.push(m[1] ?? m[2] ?? "");
			i += m[0].length;
		} else {
			break;
		}
	}
	return segments;
}

/**
 * The catalog path whose last segment equals `name`, or whose segments joined
 * with "_" equal `name` (the hook effective-name form, e.g.
 * `opencode_session_rename`). Undefined when there is no match or when the
 * name is ambiguous (2+ distinct paths match).
 */
export function findCatalogPath(
	text: string,
	name: string,
): string | undefined {
	const matches: string[] = [];
	for (const path of catalogPaths(text)) {
		const segments = pathSegments(path);
		if (segments.length === 0) {
			continue;
		}
		const last = segments.at(-1);
		if (last === undefined) {
			continue;
		}
		if (last === name || segments.join("_") === name) {
			matches.push(path);
		}
	}
	const unique = [...new Set(matches)];
	return unique.length === 1 ? unique[0] : undefined;
}

/** Text of one message `content`: either a string or an array of parts. */
export function text(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		const out: string[] = [];
		for (const part of content) {
			if (typeof part === "string") {
				out.push(part);
			} else if (
				part !== null &&
				typeof part === "object" &&
				(part as { type?: unknown }).type === "text"
			) {
				out.push(String((part as { text?: unknown }).text ?? ""));
			}
		}
		return out.join("\n");
	}
	return "";
}

/** Every message's text content joined together. */
export function allMessageText(body: unknown): string {
	const messages = (
		body as { messages?: Array<{ content?: unknown }> } | null | undefined
	)?.messages;
	if (!Array.isArray(messages)) {
		return "";
	}
	return messages
		.map((m) => text(m?.content))
		.filter((t) => t.length > 0)
		.join("\n");
}
