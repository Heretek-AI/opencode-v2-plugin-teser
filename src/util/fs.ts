// Small filesystem helpers shared by the runner and the report renderer.
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, relative } from "node:path";

/** mkdir -p. */
export function ensureDir(dir: string): void {
	mkdirSync(dir, { recursive: true });
}

/**
 * Empty `dir` (rm -rf, then mkdir -p). Evidence dirs are reset before each
 * case because the probe appends: records left by an earlier run in the same
 * out dir would otherwise be evaluated as if this run produced them. Refuses
 * any `dir` that is not strictly inside `root`, so a bad path segment can
 * never delete something outside the out dir.
 */
export function resetDir(dir: string, root: string): void {
	const rel = relative(root, dir);
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(`refusing to reset ${dir}: it is not inside ${root}`);
	}
	rmSync(dir, { recursive: true, force: true });
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
