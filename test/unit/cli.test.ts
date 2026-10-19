import { describe, expect, test } from "bun:test";
import { main } from "../../src/cli.ts";

describe("cli --version", () => {
	test("prints 0.1.1 and returns 0", async () => {
		const lines: string[] = [];
		const origLog = console.log;
		console.log = (...args: unknown[]) => {
			lines.push(args.map(String).join(" "));
		};
		try {
			const code = await main(["--version"]);
			expect(code).toBe(0);
		} finally {
			console.log = origLog;
		}
		expect(lines.join("\n")).toContain("0.1.1");
	});
});
