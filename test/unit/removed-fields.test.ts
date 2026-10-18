// OCI-1.4-providers + OCI-5.6-inert-window: already remediated by the M7
// removal (fail-closed). `expect.providers`/`expect.models` (deferred to v2)
// and `gate.window`/`gate.threshold` (upstream verdict hard-codes 5/0.9)
// are rejected by strict schemas instead of being silently ignored. This
// test pins the removal: re-accepting any of these fields goes red here.
// (Overlaps `test/unit/config-schema.test.ts`, which asserts the same four
// rejections; this file names the audit IDs so the remediation is auditable.)
import { describe, expect, test } from "bun:test";
import { ConfigSchema } from "../../src/config/schema.ts";

describe("removed fields stay removed", () => {
	test("expect.providers and expect.models fail validation", () => {
		expect(
			ConfigSchema.safeParse({ expect: { providers: ["mine"] } }).success,
		).toBe(false);
		expect(ConfigSchema.safeParse({ expect: { models: ["m"] } }).success).toBe(
			false,
		);
	});

	test("gate.window and gate.threshold fail validation", () => {
		expect(ConfigSchema.safeParse({ gate: { window: 10 } }).success).toBe(
			false,
		);
		expect(ConfigSchema.safeParse({ gate: { threshold: 0.5 } }).success).toBe(
			false,
		);
	});
});
