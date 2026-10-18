// OCI-6.2-artifact-poisoning: matrix legs uploading the same default
// artifact name collide (upload-artifact merges by name), so allowed-leg
// `latest` results can poison required-leg gate history. Validation fails
// closed when `gate.artifact` is the default AND more than one opencode
// version is configured, naming the file and field. Per-leg distinct names
// (README matrix example) pass.
import { describe, expect, test } from "bun:test";
import { formatIssues } from "../../src/config/load.ts";
import { ConfigSchema } from "../../src/config/schema.ts";

describe("gate artifact poisoning guard", () => {
	test("default artifact with two versions fails naming file and field", () => {
		const parsed = ConfigSchema.safeParse({
			opencode: { versions: ["2.0.26", "latest"] },
		});
		expect(parsed.success).toBe(false);
		if (parsed.success) {
			return;
		}
		const message = formatIssues("config.yaml", parsed.error);
		expect(message).toContain("config.yaml");
		expect(message).toContain("gate.artifact");
	});

	test("default artifact with one version passes", () => {
		expect(
			ConfigSchema.safeParse({ opencode: { versions: ["2.0.26"] } }).success,
		).toBe(true);
	});

	test("distinct artifacts with two versions pass", () => {
		expect(
			ConfigSchema.safeParse({
				opencode: { versions: ["2.0.26", "latest"] },
				gate: { artifact: "matrix-leg-results" },
			}).success,
		).toBe(true);
	});
});
