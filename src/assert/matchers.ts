// Matcher evaluation for scenario `expect` blocks. Each matcher key is
// AND-ed: every specified key must pass. Returns failure messages ([] = pass).
// Non-string values are compared as JSON.stringify for contains/notContains/
// matches/notMatches, so numbers and objects still get sensible messages.
import type { Matcher } from "../config/schema.ts";
import { truncate } from "../util/redact.ts";

/** Show a value in a message, quoting strings and truncating long output. */
function show(value: unknown): string {
	if (typeof value === "string") {
		return truncate(JSON.stringify(value) ?? '""');
	}
	try {
		return truncate(JSON.stringify(value) ?? String(value));
	} catch {
		return truncate(String(value));
	}
}

/** Text form used by contains/matches: strings as-is, anything else JSON. */
function toText(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

/** Structural equality (key order independent), no prototype tricks. */
export function deepEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) {
		return true;
	}
	if (
		a === null ||
		b === null ||
		typeof a !== "object" ||
		typeof b !== "object"
	) {
		return false;
	}
	if (Array.isArray(a) !== Array.isArray(b)) {
		return false;
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) {
			return false;
		}
		return a.every((item, index) => deepEqual(item, b[index]));
	}
	const aKeys = Object.keys(a as Record<string, unknown>);
	const bKeys = Object.keys(b as Record<string, unknown>);
	if (aKeys.length !== bKeys.length) {
		return false;
	}
	return aKeys.every(
		(key) =>
			Object.hasOwn(b, key) &&
			deepEqual(
				(a as Record<string, unknown>)[key],
				(b as Record<string, unknown>)[key],
			),
	);
}

function splitRegexFlags(source: string): { source: string; flags: string } {
	// Only leading (?i) is supported (SPEC 5.2); anything else is a literal
	// part of the pattern and goes to RegExp untouched.
	if (source.startsWith("(?i)")) {
		return { source: source.slice(4), flags: "i" };
	}
	return { source, flags: "" };
}

function compileRegex(source: string): { regex?: RegExp; error?: string } {
	const { source: body, flags } = splitRegexFlags(source);
	try {
		return { regex: new RegExp(body, flags) };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

export function check(
	value: unknown,
	matcher: Matcher,
	label: string,
): string[] {
	// A field that was never recorded fails every matcher except
	// `exists: false`. Otherwise a typo in a field name (`comand`) would let
	// `notContains`/`notMatches` pass vacuously.
	if (value === undefined && matcher.exists !== true) {
		return matcher.exists === false
			? []
			: [`${label}: no value was recorded (check the field name).`];
	}

	const failures: string[] = [];

	if (matcher.equals !== undefined && !deepEqual(value, matcher.equals)) {
		failures.push(
			`${label}: expected ${show(matcher.equals)}, got ${show(value)}.`,
		);
	}

	if (matcher.contains !== undefined) {
		const needle = toText(matcher.contains);
		const haystack = toText(value);
		if (!haystack.includes(needle)) {
			failures.push(
				`${label}: expected to contain ${show(needle)}, got ${show(haystack)}.`,
			);
		}
	}

	if (matcher.notContains !== undefined) {
		const needle = toText(matcher.notContains);
		const haystack = toText(value);
		if (haystack.includes(needle)) {
			failures.push(
				`${label}: expected not to contain ${show(needle)}, got ${show(haystack)}.`,
			);
		}
	}

	if (matcher.matches !== undefined) {
		const { regex, error } = compileRegex(matcher.matches);
		if (error !== undefined) {
			failures.push(
				`${label}: invalid regex ${show(matcher.matches)}: ${error}.`,
			);
		} else if (!regex?.test(toText(value))) {
			failures.push(
				`${label}: expected to match ${show(matcher.matches)}, got ${show(toText(value))}.`,
			);
		}
	}

	if (matcher.notMatches !== undefined) {
		const { regex, error } = compileRegex(matcher.notMatches);
		if (error !== undefined) {
			failures.push(
				`${label}: invalid regex ${show(matcher.notMatches)}: ${error}.`,
			);
		} else if (regex?.test(toText(value)) === true) {
			failures.push(
				`${label}: expected not to match ${show(matcher.notMatches)}, got ${show(toText(value))}.`,
			);
		}
	}

	if (matcher.includes !== undefined) {
		if (!Array.isArray(value)) {
			failures.push(
				`${label}: expected an array for includes, got ${show(value)}.`,
			);
		} else {
			for (const item of matcher.includes) {
				const found = (value as unknown[]).some((entry) =>
					typeof entry === "object" && entry !== null
						? deepEqual(entry, item)
						: entry === item,
				);
				if (!found) {
					failures.push(
						`${label}: expected to include ${show(item)}, got ${show(value)}.`,
					);
				}
			}
		}
	}

	if (matcher.exists !== undefined) {
		const present = value !== undefined && value !== null;
		if (matcher.exists && !present) {
			failures.push(`${label}: expected value to exist, got ${show(value)}.`);
		}
		if (!matcher.exists && present) {
			failures.push(
				`${label}: expected value not to exist, got ${show(value)}.`,
			);
		}
	}

	if (matcher.count !== undefined) {
		const n =
			typeof value === "number"
				? value
				: Array.isArray(value)
					? value.length
					: undefined;
		if (n === undefined) {
			failures.push(
				`${label}: expected a number or array for count, got ${show(value)}.`,
			);
		} else {
			const { eq, gte, lte } = matcher.count;
			if (eq !== undefined && n !== eq) {
				failures.push(`${label}: expected count == ${eq}, got ${n}.`);
			}
			if (gte !== undefined && n < gte) {
				failures.push(`${label}: expected count >= ${gte}, got ${n}.`);
			}
			if (lte !== undefined && n > lte) {
				failures.push(`${label}: expected count <= ${lte}, got ${n}.`);
			}
		}
	}

	return failures;
}
