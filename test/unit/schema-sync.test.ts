// M7: the committed JSON schemas must match what the zod schemas generate,
// so schema/config.json + schema/scenario.json can never drift.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSchemas } from "../../scripts/gen-schema.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");

test("committed schemas are in sync with the zod schemas", () => {
	const dir = mkdtempSync(join(tmpdir(), "opencode-ci-schema-"));
	writeSchemas(dir);
	for (const file of ["config.json", "scenario.json"]) {
		const fresh = readFileSync(join(dir, file), "utf8");
		const committed = readFileSync(join(REPO_ROOT, "schema", file), "utf8");
		expect(fresh, `${file} is stale: run \`bun scripts/gen-schema.ts\``).toBe(
			committed,
		);
	}
});
