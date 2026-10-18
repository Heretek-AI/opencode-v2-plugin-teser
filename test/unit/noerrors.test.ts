// OCI-2.5-noerrors: the `?? true` fallback in `evaluate` is the only thing
// standing between an opencode `error` event and a silent pass when
// `expect.noErrors` is unset. The user-facing default is schema-pinned
// (`noErrors: true`); this test pins the fallback itself, plus the fact that
// an explicit `noErrors: false` still lets error events through. NOTE: no
// scripted e2e fixture is added — no stub turn emits `error` events on a
// passing path, so the unit pin is the whole coverage.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Evidence, evaluate } from "../../src/assert/expect.ts";
import type { ScenarioExpect } from "../../src/config/schema.ts";
import type { RunEvent } from "../../src/opencode/events.ts";
import { ProbeLog } from "../../src/probe/read.ts";
import type { RunOutput } from "../../src/sandbox/sandbox.ts";

function run(events: RunEvent[]): RunOutput {
	return {
		code: 0,
		timedOut: false,
		stdout: "",
		stderr: "",
		events,
		durationMs: 1,
	};
}

function evidence(events: RunEvent[]): Evidence {
	return {
		run: run(events),
		probe: new ProbeLog([]),
		stubRequests: [],
		projectDir: mkdtempSync(join(tmpdir(), "noerrors-")),
		mode: "scripted",
	};
}

const errorEvents: RunEvent[] = [{ type: "error", error: { message: "boom" } }];

describe("noErrors fallback", () => {
	test("an unset noErrors still fails on an error event", () => {
		// `noErrors` is required in the parsed output type, so unset is
		// modeled by deleting it: this is the `?? true` fallback path.
		const scenario = { exitCode: 0, noErrors: true } as ScenarioExpect;
		delete (scenario as unknown as { noErrors?: boolean }).noErrors;
		expect("noErrors" in scenario).toBe(false);
		const failures = evaluate(scenario, evidence(errorEvents));
		expect(failures.join("\n")).toContain("error event");
	});

	test("an explicit noErrors: true fails on an error event", () => {
		const failures = evaluate(
			{ exitCode: 0, noErrors: true },
			evidence(errorEvents),
		);
		expect(failures.join("\n")).toContain("error event");
	});

	test("noErrors: false lets error events through", () => {
		const failures = evaluate(
			{ exitCode: 0, noErrors: false },
			evidence(errorEvents),
		);
		expect(failures).toEqual([]);
	});

	test("a clean run passes with noErrors unset", () => {
		const scenario = { exitCode: 0, noErrors: true } as ScenarioExpect;
		delete (scenario as unknown as { noErrors?: boolean }).noErrors;
		const failures = evaluate(scenario, evidence([]));
		expect(failures).toEqual([]);
	});
});
