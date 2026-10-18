// M9: unit tests for check() — every matcher key, (?i) handling,
// truncation of long "got" values, and non-string comparisons.
import { describe, expect, test } from "bun:test";
import { check, deepEqual } from "../../src/assert/matchers.ts";

describe("deepEqual", () => {
	test("key order independent, nested, arrays", () => {
		expect(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
		expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
		expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
		expect(deepEqual("x", "x")).toBe(true);
		expect(deepEqual(undefined, undefined)).toBe(true);
		expect(deepEqual({ a: undefined }, {})).toBe(false);
	});
});

describe("check", () => {
	test("equals passes on deep equality, fails otherwise", () => {
		expect(check({ a: [1] }, { equals: { a: [1] } }, "v")).toEqual([]);
		expect(check({ a: [1] }, { equals: { a: [2] } }, "v")).toHaveLength(1);
	});

	test("contains and notContains on strings", () => {
		expect(check("echo:hi", { contains: "echo:hi" }, "out")).toEqual([]);
		const failures = check("echo:hi", { contains: "echo:bye" }, "out");
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain('expected to contain "echo:bye"');
		expect(failures[0]).toContain('got "echo:hi"');
		expect(check("echo:hi", { notContains: "echo:bye" }, "out")).toEqual([]);
		expect(check("echo:hi", { notContains: "echo:hi" }, "out")).toHaveLength(1);
	});

	test("contains stringifies non-strings", () => {
		expect(check(42, { contains: 4 }, "n")).toEqual([]);
		expect(check({ a: 1 }, { contains: '"a":1' }, "o")).toEqual([]);
		expect(check(["x", "y"], { contains: "y" }, "a")).toEqual([]);
	});

	test("matches supports a leading (?i)", () => {
		expect(check("Hello World", { matches: "(?i)hello" }, "t")).toEqual([]);
		expect(check("Hello World", { matches: "hello" }, "t")).toHaveLength(1);
		expect(check("abc123", { notMatches: "(?i)XYZ" }, "t")).toEqual([]);
		expect(check("abcXYZ", { notMatches: "(?i)xyz" }, "t")).toHaveLength(1);
	});

	test("invalid regex fails closed", () => {
		const failures = check("x", { matches: "([invalid" }, "t");
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("invalid regex");
	});

	test("includes requires every item", () => {
		expect(check(["a", "b"], { includes: ["a", "b"] }, "tools")).toEqual([]);
		const failures = check(["a"], { includes: ["a", "c"] }, "tools");
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain('expected to include "c"');
		expect(check("nope", { includes: ["a"] }, "tools")).toHaveLength(1);
	});

	test("includes deep-compares objects", () => {
		expect(
			check([{ a: 1 }], { includes: ["{a:1}" as never] }, "x"),
		).toHaveLength(1);
	});

	test("exists true/false", () => {
		expect(check("v", { exists: true }, "x")).toEqual([]);
		expect(check(undefined, { exists: true }, "x")).toHaveLength(1);
		expect(check(null, { exists: true }, "x")).toHaveLength(1);
		expect(check(undefined, { exists: false }, "x")).toEqual([]);
		expect(check(0, { exists: false }, "x")).toHaveLength(1);
	});

	test("count eq/gte/lte on numbers and arrays", () => {
		expect(check(2, { count: { eq: 2 } }, "c")).toEqual([]);
		expect(check(2, { count: { eq: 3 } }, "c")).toHaveLength(1);
		expect(check(2, { count: { gte: 1 } }, "c")).toEqual([]);
		expect(check(0, { count: { gte: 1 } }, "c")).toHaveLength(1);
		expect(check(["a", "b"], { count: { lte: 2 } }, "c")).toEqual([]);
		expect(check("nope", { count: { gte: 1 } }, "c")).toHaveLength(1);
	});

	test("long got values are truncated to 300 chars", () => {
		const long = "x".repeat(1000);
		const failures = check(long, { contains: "zzz" }, "out");
		expect(failures).toHaveLength(1);
		expect(failures[0]?.length).toBeLessThan(long.length);
		expect(failures[0]).toContain("[+");
	});

	test("multiple keys AND together", () => {
		expect(
			check("echo:hi", { contains: "echo", notContains: "bye" }, "o"),
		).toEqual([]);
		expect(
			check("echo:bye", { contains: "echo", notContains: "bye" }, "o"),
		).toHaveLength(1);
	});
});
