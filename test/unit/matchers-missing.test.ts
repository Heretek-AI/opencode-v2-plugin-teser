// Review S4: a value that was never recorded fails every matcher except
// `exists: false`, so a misspelled field cannot pass a negative matcher.
import { describe, expect, test } from "bun:test";
import { check } from "../../src/assert/matchers.ts";

describe("matchers on a value that was never recorded", () => {
	test("notContains fails instead of passing vacuously", () => {
		expect(check(undefined, { notContains: "secret" }, "input.comand")).toEqual(
			["input.comand: no value was recorded (check the field name)."],
		);
	});

	test("notMatches and equals fail the same way", () => {
		expect(check(undefined, { notMatches: "x" }, "a")).toEqual([
			"a: no value was recorded (check the field name).",
		]);
		expect(check(undefined, { equals: "x" }, "a")).toEqual([
			"a: no value was recorded (check the field name).",
		]);
	});

	test("exists: false passes, exists: true fails", () => {
		expect(check(undefined, { exists: false }, "x")).toEqual([]);
		expect(check(undefined, { exists: true }, "x")).toEqual([
			"x: expected value to exist, got undefined.",
		]);
	});

	test("null counts as recorded", () => {
		expect(check(null, { notContains: "secret" }, "x")).toEqual([]);
	});
});
