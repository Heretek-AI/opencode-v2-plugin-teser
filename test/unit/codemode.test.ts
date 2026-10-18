// M4: catalog parsing unit tests. The catalog text below was captured from
// opencode 2.0.26 (IMPLEMENTATION_PROMPT M4).
import { describe, expect, test } from "bun:test";
import {
	allMessageText,
	catalogPaths,
	findCatalogPath,
	pathSegments,
	text,
} from "../../src/stub/codemode.ts";

const CATALOG = `- opencode (2 tools)
  - tools.opencode.session_move({
  directory: string,
}): Promise<{ sessionID: string, directory: string }> // Move a session …
  - tools.opencode.session_rename({
  title: string,
}): Promise<{ sessionID: string, title: string }> // Rename a session …
- spike_echo (1 tool)
  - tools.spike_echo({
  text: string,
}): Promise<string | null> // Echo the input text back`;

describe("catalogPaths", () => {
	test("lists every tools call path", () => {
		expect(catalogPaths(CATALOG)).toEqual([
			"tools.opencode.session_move",
			"tools.opencode.session_rename",
			"tools.spike_echo",
		]);
	});

	test("handles bracket-quoted segments", () => {
		const text = `- ns (1 tool)
  - tools.ns["my-tool"]({
  text: string,
}): Promise<string | null>`;
		expect(catalogPaths(text)).toEqual(['tools.ns["my-tool"]']);
	});

	test("ignores non-catalog lines", () => {
		expect(catalogPaths("no tools here\njust text")).toEqual([]);
	});
});

describe("pathSegments", () => {
	test("dot segments", () => {
		expect(pathSegments("tools.opencode.session_rename")).toEqual([
			"opencode",
			"session_rename",
		]);
	});

	test("single segment", () => {
		expect(pathSegments("tools.spike_echo")).toEqual(["spike_echo"]);
	});

	test("bracket-quoted segments", () => {
		expect(pathSegments('tools.ns["my-tool"]')).toEqual(["ns", "my-tool"]);
		expect(pathSegments("tools.ns['my-tool']")).toEqual(["ns", "my-tool"]);
	});

	test("non-tools path yields no segments", () => {
		expect(pathSegments("other.thing")).toEqual([]);
	});
});

describe("findCatalogPath", () => {
	test("exact last segment", () => {
		expect(findCatalogPath(CATALOG, "spike_echo")).toBe("tools.spike_echo");
	});

	test("underscore-joined namespace form", () => {
		expect(findCatalogPath(CATALOG, "opencode_session_rename")).toBe(
			"tools.opencode.session_rename",
		);
	});

	test("bare last segment under a namespace", () => {
		expect(findCatalogPath(CATALOG, "session_rename")).toBe(
			"tools.opencode.session_rename",
		);
	});

	test("unknown name", () => {
		expect(findCatalogPath(CATALOG, "nope")).toBeUndefined();
	});

	test("ambiguous name yields undefined", () => {
		const text = `${CATALOG}
- other (1 tool)
  - tools.other.session_rename({
  title: string,
}): Promise<void>`;
		expect(findCatalogPath(text, "session_rename")).toBeUndefined();
	});

	test("bracket path by last segment", () => {
		const text = `- ns (1 tool)
  - tools.ns["my-tool"]({
  text: string,
}): Promise<string | null>`;
		expect(findCatalogPath(text, "my-tool")).toBe('tools.ns["my-tool"]');
		expect(findCatalogPath(text, "ns_my-tool")).toBe('tools.ns["my-tool"]');
	});
});

describe("message text helpers", () => {
	test("text() handles string content", () => {
		expect(text("hello")).toBe("hello");
	});

	test("text() handles array content", () => {
		expect(
			text([
				{ type: "text", text: "a" },
				{ type: "image", text: "ignored" },
				"b",
			]),
		).toBe("a\nb");
	});

	test("allMessageText joins every message", () => {
		const body = {
			messages: [
				{ role: "system", content: "sys" },
				{
					role: "user",
					content: [
						{ type: "text", text: "hi" },
						{ type: "text", text: "there" },
					],
				},
			],
		};
		expect(allMessageText(body)).toBe("sys\nhi\nthere");
	});

	test("allMessageText tolerates missing messages", () => {
		expect(allMessageText({})).toBe("");
		expect(allMessageText(undefined)).toBe("");
	});
});
