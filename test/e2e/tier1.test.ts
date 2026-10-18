// M8 acceptance (e2e, needs OPENCODE_BIN or the dev install at
// review/oc/node_modules/.bin/opencode):
// - tool-basic passes tier 1 with the expected tool listed,
// - throws fails with "fixture boom" in the failures,
// - no-entry resolves to {} (validate/run exit 2 via ConfigError upstream),
// - tui-only passes static tier 1, tui-broken fails static tier 1.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ConfigError } from "../../src/config/load.ts";
import {
	ensureEntriesOrThrow,
	resolveEntries,
} from "../../src/plugin/entry.ts";
import { runLoad } from "../../src/tiers/load.ts";
import { runUiStatic } from "../../src/tiers/ui-static.ts";

const FIXTURES = resolve(import.meta.dir, "../fixtures/plugins");

function opencodeBin(): string {
	return (
		process.env.OPENCODE_BIN ??
		resolve(import.meta.dir, "../../review/oc/node_modules/.bin/opencode")
	);
}

/** The fixture's server entry, resolved the way `run` resolves it. */
function serverEntryOf(name: string): string {
	const entry = resolveEntries(join(FIXTURES, name)).server;
	if (entry === undefined) {
		throw new Error(`fixture ${name} has no server entry`);
	}
	return entry;
}

function outDir(name: string): string {
	return mkdtempSync(join(tmpdir(), `tier1-${name}-`));
}

describe("tier 1 (load)", () => {
	test("tool-basic passes with the expected tool listed", async () => {
		const result = await runLoad({
			pluginPath: join(FIXTURES, "tool-basic"),
			serverEntry: serverEntryOf("tool-basic"),
			opencodeBin: opencodeBin(),
			outDir: outDir("tool-basic"),
			version: "2.0.26",
			expected: { tools: ["echo_tool"] },
		});
		expect(result.id).toBe("load");
		expect(result.tier).toBe("load");
		expect(result.failures ?? []).toEqual([]);
		expect(result.pass).toBe(true);
	}, 600_000);

	test("throws fails with fixture boom", async () => {
		const result = await runLoad({
			pluginPath: join(FIXTURES, "throws"),
			serverEntry: serverEntryOf("throws"),
			opencodeBin: opencodeBin(),
			outDir: outDir("throws"),
			version: "2.0.26",
		});
		expect(result.pass).toBe(false);
		expect((result.failures ?? []).join("\n")).toMatch(/fixture boom/);
	}, 600_000);

	test("no-entry resolves to empty entries (exit 2 upstream)", () => {
		expect(resolveEntries(join(FIXTURES, "no-entry"))).toEqual({});
		let error: unknown;
		try {
			ensureEntriesOrThrow(join(FIXTURES, "no-entry"));
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(ConfigError);
	});

	test("missing expected tool is reported", async () => {
		const result = await runLoad({
			pluginPath: join(FIXTURES, "tool-basic"),
			serverEntry: serverEntryOf("tool-basic"),
			opencodeBin: opencodeBin(),
			outDir: outDir("missing-tool"),
			version: "2.0.26",
			expected: { tools: ["no_such_tool"] },
		});
		expect(result.pass).toBe(false);
		expect((result.failures ?? []).join("\n")).toMatch(/no_such_tool/);
	}, 600_000);
});

describe("tier 1 static (TUI-only)", () => {
	test("tui-only passes", async () => {
		const result = await runUiStatic({
			pluginPath: join(FIXTURES, "tui-only"),
			outDir: outDir("tui-only"),
			version: "2.0.26",
		});
		expect(result.pass).toBe(true);
	}, 120_000);

	test("tui-broken fails", async () => {
		const result = await runUiStatic({
			pluginPath: join(FIXTURES, "tui-broken"),
			outDir: outDir("tui-broken"),
			version: "2.0.26",
		});
		expect(result.pass).toBe(false);
		expect((result.failures ?? []).join("\n")).toMatch(
			/static TUI import failed/,
		);
	}, 120_000);
});
