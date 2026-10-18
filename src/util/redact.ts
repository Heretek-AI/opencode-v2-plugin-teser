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
 * Env names that mark a value as secret-bearing. Mirrors the probe's
 * SECRET_KEY regex in `probe/core.js`: the probe redacts by NAME at the
 * source, while `redactSecretValues` below scrubs by VALUE as defense in
 * depth on persisted evidence.
 */
export const SECRET_NAME_RE = /KEY|TOKEN|SECRET|PASSWORD|AUTH|COOKIE/i;

/**
 * Minimum secret length worth scrubbing. Shorter values (a one-char flag, a
 * port number) would nuke unrelated evidence text.
 */
const MIN_SECRET_LENGTH = 4;

/**
 * Replace every occurrence of each known secret value with `[redacted]`.
 * Longer secrets go first so overlapping values scrub completely. Empty,
 * whitespace-only and short values are skipped. Never throws: returns the
 * text unchanged on malformed input. Split/join (not regex) so values with
 * regex metacharacters are matched literally.
 */
export function redactSecretValues(text: string, secrets: string[]): string {
	let values: string[];
	try {
		values = [...new Set(secrets)].filter(
			(secret) =>
				typeof secret === "string" && secret.trim().length >= MIN_SECRET_LENGTH,
		);
	} catch {
		return text;
	}
	values.sort((a, b) => b.length - a.length);
	let out = text;
	for (const value of values) {
		out = out.split(value).join("[redacted]");
	}
	return out;
}

/**
 * Collect live secret values: every non-empty env value whose NAME looks
 * secret-bearing, plus the values of explicitly configured key names
 * (`extra`, e.g. `collectLiveKeys(config)` — a key var may have an innocuous
 * name like `MY_API`). Values travel only into scrubbing, never into logs.
 */
export function collectSecretValues(extra?: Record<string, string>): string[] {
	const values: string[] = [];
	for (const [name, value] of Object.entries(process.env)) {
		if (
			typeof value === "string" &&
			value.length > 0 &&
			SECRET_NAME_RE.test(name)
		) {
			values.push(value);
		}
	}
	for (const value of Object.values(extra ?? {})) {
		if (typeof value === "string" && value.length > 0) {
			values.push(value);
		}
	}
	return values;
}
