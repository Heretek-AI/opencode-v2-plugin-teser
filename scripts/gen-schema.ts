// Writes schema/config.json + schema/scenario.json from the zod schemas.
// Run with `bun scripts/gen-schema.ts [outDir]`. The schema-sync unit test
// calls writeSchemas() directly, so generated files can never drift.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ConfigSchema, ScenarioSchema } from "../src/config/schema.ts";

export function writeSchemas(outDir: string): void {
	mkdirSync(outDir, { recursive: true });
	writeFileSync(
		join(outDir, "config.json"),
		`${JSON.stringify(z.toJSONSchema(ConfigSchema), null, 2)}\n`,
	);
	writeFileSync(
		join(outDir, "scenario.json"),
		`${JSON.stringify(z.toJSONSchema(ScenarioSchema), null, 2)}\n`,
	);
}

if (import.meta.main) {
	const outDir = process.argv[2] ?? join(import.meta.dir, "..", "schema");
	writeSchemas(outDir);
}
