// Review B5 follow-ups: scenario ids that collide with the tool's own case
// ids are rejected, and workspace files must stay inside the project dir.
import { describe, expect, test } from "bun:test";
import { ScenarioSchema } from "../../src/config/schema.ts";

const base = { mode: "scripted", prompt: "hi", script: [] };

describe("scenario rules", () => {
	test("ids load and bun-test are reserved", () => {
		for (const id of ["load", "bun-test"]) {
			const parsed = ScenarioSchema.safeParse({ ...base, id });
			expect(parsed.success).toBe(false);
			if (!parsed.success) {
				expect(parsed.error.issues[0]?.message).toBe(
					`scenario "${id}": id "${id}" is reserved (the tool uses it for its own case and evidence dir)`,
				);
			}
		}
	});

	test("workspace paths must stay inside the project dir", () => {
		for (const key of ["../escape.txt", "a/../../b", "/etc/passwd"]) {
			const parsed = ScenarioSchema.safeParse({
				...base,
				id: "ws",
				workspace: { [key]: "x" },
			});
			expect(parsed.success).toBe(false);
			if (!parsed.success) {
				expect(parsed.error.issues[0]?.message).toBe(
					`scenario "ws": workspace path "${key}" must be relative and stay inside the project dir`,
				);
			}
		}
		const ok = ScenarioSchema.safeParse({
			...base,
			id: "ws",
			workspace: { "a/b.txt": "x", ".env": "A=1" },
		});
		expect(ok.success).toBe(true);
	});
});
