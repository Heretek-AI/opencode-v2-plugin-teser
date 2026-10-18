// Unit tests for src/plugin/entry.ts: every resolution branch gets its own
// temp plugin directory.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigError } from "../../src/config/load.ts";
import {
	ensureEntriesOrThrow,
	pickExportTarget,
	resolveEntries,
} from "../../src/plugin/entry.ts";
import { writeShim } from "../../src/plugin/shim.ts";

function makeDir(): string {
	return mkdtempSync(join(tmpdir(), "entry-test-"));
}

function writePkg(dir: string, pkg: unknown): void {
	writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
}

function writeFile(
	dir: string,
	rel: string,
	content = "export default {};",
): void {
	const dest = join(dir, rel);
	mkdirSync(join(dest, ".."), { recursive: true });
	writeFileSync(dest, content);
}

describe("pickExportTarget", () => {
	test("plain string passes through", () => {
		expect(pickExportTarget("./src/server.ts")).toBe("./src/server.ts");
	});
	test("conditions prefer import over the rest", () => {
		expect(
			pickExportTarget({
				types: "./x.d.ts",
				node: "./node.js",
				default: "./def.js",
				import: "./imp.js",
			}),
		).toBe("./imp.js");
	});
	test("default is used when import is absent", () => {
		expect(pickExportTarget({ types: "./x.d.ts", default: "./def.js" })).toBe(
			"./def.js",
		);
	});
	test("bun/node conditions resolve", () => {
		expect(pickExportTarget({ bun: "./b.ts" })).toBe("./b.ts");
		expect(pickExportTarget({ node: "./n.js" })).toBe("./n.js");
	});
	test("nested { '.': { import } } resolves", () => {
		expect(pickExportTarget({ ".": { import: "./nested.js" } })).toBe(
			"./nested.js",
		);
	});
	test("non-strings resolve to undefined", () => {
		expect(pickExportTarget(undefined)).toBeUndefined();
		expect(pickExportTarget(42)).toBeUndefined();
		expect(pickExportTarget(["./x.js"])).toBeUndefined();
		expect(pickExportTarget({})).toBeUndefined();
	});
});

describe("resolveEntries", () => {
	test("explicit entry wins when the file exists", () => {
		const dir = makeDir();
		writeFile(dir, "custom/entry.ts");
		writeFile(dir, "server.ts");
		expect(resolveEntries(dir, "custom/entry.ts").server).toBe(
			resolve(dir, "custom/entry.ts"),
		);
	});
	test("missing explicit entry throws instead of falling back", () => {
		const dir = makeDir();
		writeFile(dir, "server.ts");
		expect(() => resolveEntries(dir, "does/not-exist.ts")).toThrow(
			/plugin\.entry "does\/not-exist\.ts" does not exist/,
		);
	});
	test("absolute explicit entry is used as is", () => {
		const dir = makeDir();
		const abs = resolve(dir, "abs.ts");
		writeFile(dir, "abs.ts");
		expect(resolveEntries(dir, abs).server).toBe(abs);
	});
	test("exports['./server'] string resolves", () => {
		const dir = makeDir();
		writePkg(dir, { name: "x", exports: { "./server": "./src/server.ts" } });
		writeFile(dir, "src/server.ts");
		expect(resolveEntries(dir).server).toBe(resolve(dir, "src/server.ts"));
	});
	test("exports['./server'] conditions object resolves via import", () => {
		const dir = makeDir();
		writePkg(dir, {
			name: "x",
			exports: {
				"./server": { types: "./src/s.d.ts", import: "./src/server.ts" },
			},
		});
		writeFile(dir, "src/server.ts");
		expect(resolveEntries(dir).server).toBe(resolve(dir, "src/server.ts"));
	});
	test("exports['.'] string is the fallback", () => {
		const dir = makeDir();
		writePkg(dir, { name: "x", exports: { ".": "./main-entry.js" } });
		writeFile(dir, "main-entry.js");
		expect(resolveEntries(dir).server).toBe(resolve(dir, "main-entry.js"));
	});
	test("exports['.'] nested conditions resolve", () => {
		const dir = makeDir();
		writePkg(dir, {
			name: "x",
			exports: { ".": { ".": { import: "./n.js" } } },
		});
		writeFile(dir, "n.js");
		expect(resolveEntries(dir).server).toBe(resolve(dir, "n.js"));
	});
	test("top-level string exports resolves", () => {
		const dir = makeDir();
		writePkg(dir, { name: "x", exports: "./top.js" });
		writeFile(dir, "top.js");
		expect(resolveEntries(dir).server).toBe(resolve(dir, "top.js"));
	});
	test("package.json main resolves", () => {
		const dir = makeDir();
		writePkg(dir, { name: "x", main: "./lib/main.js" });
		writeFile(dir, "lib/main.js");
		expect(resolveEntries(dir).server).toBe(resolve(dir, "lib/main.js"));
	});
	test.each(["server.ts", "server.js", "server.mjs"] as const)(
		"plain %s resolves without package.json",
		(name) => {
			const dir = makeDir();
			writeFile(dir, name);
			expect(resolveEntries(dir).server).toBe(resolve(dir, name));
		},
	);
	test.each(["index.ts", "index.js", "index.mjs"] as const)(
		"plain %s resolves without package.json",
		(name) => {
			const dir = makeDir();
			writeFile(dir, name);
			expect(resolveEntries(dir).server).toBe(resolve(dir, name));
		},
	);
	test("server.ts beats index.ts", () => {
		const dir = makeDir();
		writeFile(dir, "server.ts");
		writeFile(dir, "index.ts");
		expect(resolveEntries(dir).server).toBe(resolve(dir, "server.ts"));
	});
	test("exports beats plain server.ts", () => {
		const dir = makeDir();
		writePkg(dir, { name: "x", exports: { "./server": "./src/server.ts" } });
		writeFile(dir, "src/server.ts");
		writeFile(dir, "server.ts");
		expect(resolveEntries(dir).server).toBe(resolve(dir, "src/server.ts"));
	});
	test("dangling exports target falls through to plain files", () => {
		const dir = makeDir();
		writePkg(dir, { name: "x", exports: { "./server": "./gone.ts" } });
		writeFile(dir, "server.ts");
		expect(resolveEntries(dir).server).toBe(resolve(dir, "server.ts"));
	});
	test("missing package.json falls through to plain files", () => {
		const dir = makeDir();
		writeFile(dir, "index.js");
		expect(resolveEntries(dir).server).toBe(resolve(dir, "index.js"));
	});
	test("invalid package.json falls through to plain files", () => {
		const dir = makeDir();
		writeFileSync(join(dir, "package.json"), "{ not json");
		writeFile(dir, "server.js");
		expect(resolveEntries(dir).server).toBe(resolve(dir, "server.js"));
	});
	test("exports['./tui'] resolves, then tui.ts", () => {
		const dir = makeDir();
		writePkg(dir, { name: "x", exports: { "./tui": "./src/tui.ts" } });
		writeFile(dir, "src/tui.ts");
		writeFile(dir, "tui.ts");
		expect(resolveEntries(dir).tui).toBe(resolve(dir, "src/tui.ts"));
		const plain = makeDir();
		writeFile(plain, "tui.ts");
		expect(resolveEntries(plain).tui).toBe(resolve(plain, "tui.ts"));
	});
	test.each(["tui.js", "tui.mjs"] as const)("plain %s resolves", (name) => {
		const dir = makeDir();
		writeFile(dir, name);
		expect(resolveEntries(dir).tui).toBe(resolve(dir, name));
	});
	test("empty directory resolves to {}", () => {
		const dir = makeDir();
		writePkg(dir, { name: "x" });
		expect(resolveEntries(dir)).toEqual({});
	});
	test("tool-basic fixture resolves via exports to src/server.ts", () => {
		const dir = resolve(import.meta.dir, "../fixtures/plugins/tool-basic");
		const entries = resolveEntries(dir);
		expect(entries.server).toBe(resolve(dir, "src/server.ts"));
	});
});

describe("ensureEntriesOrThrow", () => {
	test("empty resolution throws ConfigError mentioning no server entry", () => {
		const dir = makeDir();
		writePkg(dir, { name: "x" });
		let error: unknown;
		try {
			ensureEntriesOrThrow(dir);
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(ConfigError);
		expect(String((error as Error).message)).toMatch(/no server entry/i);
	});
	test("TUI-only directory does not throw", () => {
		const dir = makeDir();
		writeFile(dir, "tui.ts");
		expect(ensureEntriesOrThrow(dir).tui).toBe(resolve(dir, "tui.ts"));
	});
});

describe("writeShim", () => {
	test("writes plugin-under-test/server.js with the exact re-export", () => {
		const dir = makeDir();
		const entry = resolve(dir, "src", "server.ts");
		writeFile(dir, "src/server.ts");
		const shimDir = writeShim(dir, entry);
		expect(shimDir).toBe(join(dir, "plugin-under-test"));
		const content = readFileSync(join(shimDir, "server.js"), "utf8");
		expect(content).toBe(
			`export { default } from "${pathToFileURL(entry).href}";`,
		);
	});
});
