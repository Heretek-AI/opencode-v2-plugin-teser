// logfmt parser for opencode `--print-logs` stderr (one entry per line).
// Handles key=value, key="quoted with \"escapes\"", and keys with dots
// (e.g. plugin.id). Levels are uppercase (INFO, WARN, ERROR, ...); some lines
// use msg= instead of message=.

export type LogLine = Record<string, string> & { _raw: string };

export function parseLogLine(line: string): Record<string, string> | undefined {
	if (line.trim().length === 0) {
		return undefined;
	}
	const out: Record<string, string> = {};
	const n = line.length;
	let i = 0;

	const skipSpaces = (): void => {
		while (i < n && line[i] === " ") {
			i += 1;
		}
	};

	while (i < n) {
		skipSpaces();
		if (i >= n) {
			break;
		}
		let key = "";
		while (i < n && line[i] !== "=" && line[i] !== " ") {
			key += line[i];
			i += 1;
		}
		if (i >= n || line[i] !== "=") {
			// Bare token with no value: keep it with an empty value.
			if (key.length > 0) {
				out[key] = "";
			}
			continue;
		}
		i += 1; // consume '='
		let value = "";
		if (i < n && line[i] === '"') {
			i += 1; // consume opening quote
			while (i < n && line[i] !== '"') {
				if (line[i] === "\\" && i + 1 < n) {
					i += 1;
					value += line[i];
					i += 1;
				} else {
					value += line[i];
					i += 1;
				}
			}
			if (i < n) {
				i += 1; // consume closing quote
			}
		} else {
			while (i < n && line[i] !== " ") {
				value += line[i];
				i += 1;
			}
		}
		out[key] = value;
	}
	return out;
}

export function parseLogs(stderr: string): LogLine[] {
	const lines: LogLine[] = [];
	for (const raw of stderr.split("\n")) {
		const parsed = parseLogLine(raw);
		if (parsed === undefined) {
			continue;
		}
		lines.push({ ...parsed, _raw: raw });
	}
	return lines;
}

export interface PluginLogFilter {
	id?: string;
	path?: string;
}

// Lines that blame the plugin under test:
// - level ERROR/FATAL whose raw line names the plugin id or path, or
// - message/msg "failed to load plugin" with plugin.id equal to the plugin id.
export function pluginLogProblems(
	lines: LogLine[],
	filter: PluginLogFilter,
): LogLine[] {
	const problems: LogLine[] = [];
	for (const line of lines) {
		const level = line["level"];
		if (level === "ERROR" || level === "FATAL") {
			const namesId = filter.id !== undefined && line._raw.includes(filter.id);
			const namesPath =
				filter.path !== undefined && line._raw.includes(filter.path);
			if (namesId || namesPath) {
				problems.push(line);
				continue;
			}
		}
		const message = line["message"] ?? line["msg"];
		if (
			message === "failed to load plugin" &&
			filter.id !== undefined &&
			line["plugin.id"] === filter.id
		) {
			problems.push(line);
		}
	}
	return problems;
}
