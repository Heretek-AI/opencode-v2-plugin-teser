// Small filesystem helpers shared by the runner and the report renderer.
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";

/** mkdir -p. */
export function ensureDir(dir: string): void {
	mkdirSync(dir, { recursive: true });
}

/** True when path exists and is a regular file. Never throws. */
export function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/** Write records as JSON lines (one object per line, trailing newline). */
export function writeJsonl(file: string, records: unknown[]): void {
	const text = records.map((r) => JSON.stringify(r)).join("\n");
	writeFileSync(file, text.length > 0 ? `${text}\n` : "", "utf8");
}

/**
 * Read JSON lines defensively: missing files yield [], blank lines are
 * skipped, and bad lines are skipped (a torn final line must not be fatal).
 */
export function readJsonl(file: string): unknown[] {
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return [];
	}
	const out: unknown[] = [];
	for (const line of text.split("\n")) {
		if (line.trim() === "") {
			continue;
		}
		try {
			out.push(JSON.parse(line) as unknown);
		} catch {
			// Skip torn lines.
		}
	}
	return out;
}

/** Append text to a file (used for $GITHUB_STEP_SUMMARY). Never throws. */
export function appendFile(file: string, text: string): void {
	try {
		appendFileSync(file, text, "utf8");
	} catch {
		// Best effort: a failed step summary must not fail the run.
	}
}
