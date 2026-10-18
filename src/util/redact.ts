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
