// OCI-4.3-order: tier-1 sandbox plugin order `[pre, plugin, post]`. Hook
// order follows the config `plugins` array, so the pre-probe records what
// the plugin under test receives and the post-probe records what it
// produces. A `[post, shim, pre]` swap sabotage silently inverts pre/post
// attribution for tier-1 evidence; this test pins the order at the single
// construction site (`buildLoadPlugins` in `src/tiers/load.ts`, called by
// `runLoad`). NOTE: a `runLoad`-level hook-order e2e is inapplicable — tier 1
// runs one `{"text": "ok"}` stub turn with no tool calls, so tier-1
// `probe.jsonl` holds no hook records to compare; the scripted copy of this
// order IS pinned by the `hook-mutate-pass` e2e.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildLoadPlugins } from "../../src/tiers/load.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");

describe("tier-1 plugin order", () => {
	test("buildLoadPlugins returns [pre, shim, post]", () => {
		const plugins = buildLoadPlugins(
			"probe/pre",
			"shim",
			"probe/post",
			{ opt: 1 },
			"out/probe.jsonl",
		);
		expect(plugins.map((p) => p.package)).toEqual([
			"probe/pre",
			"shim",
			"probe/post",
		]);
		expect(plugins[0]?.options).toEqual({
			out: "out/probe.jsonl",
			phase: "pre",
		});
		expect(plugins[1]?.options).toEqual({ opt: 1 });
		expect(plugins[2]?.options).toEqual({
			out: "out/probe.jsonl",
			phase: "post",
		});
	});

	test("runLoad builds its sandbox from buildLoadPlugins in order", () => {
		// Fail closed on shape drift: if runLoad ever stops calling the pinned
		// constructor, this test — not tier 1 — must say so.
		const source = readFileSync(
			join(REPO_ROOT, "src", "tiers", "load.ts"),
			"utf8",
		);
		expect(source).toContain("plugins: buildLoadPlugins(");
		const call = source.slice(source.indexOf("plugins: buildLoadPlugins("));
		const pre = call.indexOf("pre,");
		const shim = call.indexOf("shimDir,");
		const post = call.indexOf("post,");
		expect(pre).toBeGreaterThanOrEqual(0);
		expect(shim).toBeGreaterThan(pre);
		expect(post).toBeGreaterThan(shim);
	});
});
