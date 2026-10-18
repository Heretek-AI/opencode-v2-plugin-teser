// OCI-4.4-ancestor: the tier-1 inventory must be exactly the configured set
// (pre/post probes plus the plugin under test), and an ancestor
// opencode.json(c) must be detected. Pure-helper tests: the fake opencode
// binary cannot plant foreign plugins, so the allow-list is pinned here.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	detectAncestorConfig,
	expectedInventoryIds,
	findUnexpectedPlugins,
	PROBE_PLUGIN_IDS,
} from "../../src/tiers/load.ts";
import { cleanupTempDirs, tempDir } from "../helpers/tmp.ts";

afterAll(cleanupTempDirs);

describe("expectedInventoryIds", () => {
	test("without a plugin id only the probes are allowed", () => {
		expect(expectedInventoryIds(undefined)).toEqual([...PROBE_PLUGIN_IDS]);
	});

	test("the plugin under test joins the probes when known", () => {
		expect(expectedInventoryIds("fixture-under-test")).toEqual([
			"opencode-plugin-ci.probe.pre",
			"opencode-plugin-ci.probe.post",
			"fixture-under-test",
		]);
	});
});

describe("findUnexpectedPlugins", () => {
	const pre = "/tool/probe/pre";
	const post = "/tool/probe/post";
	const shim = "/out/load/plugin-under-test";
	const dirs = [pre, shim, post];
	const ids = expectedInventoryIds("fixture-under-test");

	test("a clean inventory (builtins + probes + fixture) is expected", () => {
		const plugins = [
			{ id: "opencode.tool.shell", source: { type: "builtin" } },
			{ id: "opencode.config.worktree", source: { type: "builtin" } },
			{
				id: "opencode-plugin-ci.probe.pre",
				source: { type: "local", path: `${pre}/server.js` },
			},
			{
				id: "fixture-under-test",
				source: { type: "local", path: `${shim}/server.js` },
			},
			{
				id: "opencode-plugin-ci.probe.post",
				source: { type: "local", path: `${post}/server.js` },
			},
		];
		expect(findUnexpectedPlugins(plugins, ids, dirs)).toEqual([]);
	});

	test("a foreign npm plugin from an ancestor config is reported", () => {
		const plugins = [
			{ id: "opencode.tool.shell", source: { type: "builtin" } },
			{
				id: "@heretek-ai/opencode-rea",
				source: { type: "npm", name: "@heretek-ai/opencode-rea" },
			},
			{
				id: "fixture-under-test",
				source: { type: "local", path: `${shim}/server.js` },
			},
		];
		expect(findUnexpectedPlugins(plugins, ids, dirs)).toEqual([
			"@heretek-ai/opencode-rea",
		]);
	});

	test("a colliding probe id at a foreign path is reported", () => {
		const plugins = [
			{
				id: "opencode-plugin-ci.probe.pre",
				source: { type: "local", path: "/evil/server.js" },
			},
		];
		expect(findUnexpectedPlugins(plugins, ids, dirs)).toEqual([
			"opencode-plugin-ci.probe.pre",
		]);
	});

	test("a plugin without a verifiable origin fails closed", () => {
		expect(findUnexpectedPlugins([{ id: "mystery" }], ids, dirs)).toEqual([
			"mystery",
		]);
	});

	test("a missing plugin id leaves only the probes allowed", () => {
		expect(
			findUnexpectedPlugins(
				[{ id: "stranger", source: { type: "npm", name: "stranger" } }],
				expectedInventoryIds(undefined),
				dirs,
			),
		).toEqual(["stranger"]);
	});

	test("duplicates are reported once", () => {
		const plugins = [
			{ id: "x", source: { type: "npm", name: "x" } },
			{ id: "x", source: { type: "npm", name: "x" } },
		];
		expect(findUnexpectedPlugins(plugins, [], dirs)).toEqual(["x"]);
	});
});

describe("detectAncestorConfig", () => {
	test("finds a planted ancestor opencode.json", () => {
		const root = tempDir("ancestor-guard-");
		const deep = join(root, "a", "b", "c");
		mkdirSync(deep, { recursive: true });
		writeFileSync(join(root, "a", "opencode.json"), "{}");
		expect(detectAncestorConfig(deep)).toBe(join(root, "a", "opencode.json"));
	});

	test("finds opencode.jsonc too", () => {
		const root = tempDir("ancestor-guard-jsonc-");
		mkdirSync(join(root, "sub"), { recursive: true });
		writeFileSync(join(root, "opencode.jsonc"), "{}");
		expect(detectAncestorConfig(join(root, "sub"))).toBe(
			join(root, "opencode.jsonc"),
		);
	});

	test("returns undefined when no ancestor config exists", () => {
		const root = tempDir("ancestor-clean-");
		const deep = join(root, "x", "y");
		mkdirSync(deep, { recursive: true });
		expect(detectAncestorConfig(deep)).toBeUndefined();
	});
});
