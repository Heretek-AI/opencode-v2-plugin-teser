// Shared string helpers for failure messages. Kept in src (not in probe/)
// so both matchers and tiers can use them without duplicating logic.
export const TRUNCATE_MAX = 300;

/** Clip a string to `max` chars, marking the cut so long output stays readable. */
export function truncate(text: string, max: number = TRUNCATE_MAX): string {
	if (text.length <= max) {
		return text;
	}
	return `${text.slice(0, max)}…[+${text.length - max}]`;
}

/** Short one-line excerpt of a value for failure messages. */
export function excerpt(value: unknown, max: number = TRUNCATE_MAX): string {
	if (typeof value === "string") {
		return truncate(value, max);
	}
	try {
		const json = JSON.stringify(value) ?? String(value);
		return truncate(json, max);
	} catch {
		return truncate(String(value), max);
	}
}

/**
 * Env names that used to mark a value as secret-bearing. Kept for API
 * compatibility; no longer used for scrubbing.
 *
 * @deprecated Host-env scanning was removed: it scrubbed innocuous values
 * (e.g. `TOKENIZERS_PARALLELISM=false`) out of persisted evidence and broke
 * JSONL files. Scrubbing now covers only explicitly passed live-key values.
 */
export const SECRET_NAME_RE = /KEY|TOKEN|SECRET|PASSWORD|AUTH|COOKIE/i;

/**
 * Minimum secret length worth scrubbing. Shorter values (a one-char flag, a
 * port number, or common words like "false") would nuke unrelated evidence
 * text.
 */
const MIN_SECRET_LENGTH = 8;

/**
 * Replace every occurrence of each known secret value with `[redacted]`.
 * Longer secrets go first so overlapping values scrub completely, and each
 * value's JSON-escaped form (`JSON.stringify(value).slice(1, -1)`) is
 * scrubbed too, so secrets containing `"` or `\` are still caught inside
 * JSONL lines. Empty, whitespace-only and short values are skipped. Never
 * throws: returns the text unchanged on malformed input. Split/join (not
 * regex) so values with regex metacharacters are matched literally.
 */
export function redactSecretValues(text: string, secrets: string[]): string {
	try {
		if (typeof text !== "string") {
			return text;
		}
		if (!Array.isArray(secrets)) {
			return text;
		}
		const variants = new Set<string>();
		for (const secret of new Set(secrets)) {
			if (typeof secret !== "string") {
				continue;
			}
			if (secret.trim().length < MIN_SECRET_LENGTH) {
				continue;
			}
			variants.add(secret);
			const escaped = JSON.stringify(secret).slice(1, -1);
			if (escaped !== secret) {
				variants.add(escaped);
			}
		}
		const values = [...variants].sort((a, b) => b.length - a.length);
		let out = text;
		for (const value of values) {
			out = out.split(value).join("[redacted]");
		}
		return out;
	} catch {
		return text;
	}
}

/**
 * Collect live secret values: the values of explicitly configured key names
 * (`extra`, e.g. `collectLiveKeys(config)` — a key var may have an innocuous
 * name like `MY_API`). Host environment variables are deliberately NOT
 * scanned: the sandbox env is an allowlist, so host vars never reach tier 1
 * or scripted runs, and scanning them scrubbed innocuous values (e.g.
 * `TOKENIZERS_PARALLELISM=false`) out of persisted evidence. Values travel
 * only into scrubbing, never into logs.
 */
export function collectSecretValues(extra?: Record<string, string>): string[] {
	const values: string[] = [];
	for (const value of Object.values(extra ?? {})) {
		if (typeof value === "string" && value.length > 0) {
			values.push(value);
		}
	}
	return values;
}
