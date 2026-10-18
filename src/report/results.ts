// Results file shape: the IUMBTEMS EvalRow shape (`id`, `pass`, `tools`,
// `failures`, `steps`, `costUSD`, `textExcerpt`, `kept`, ...) extended with
// `tier` and `opencode` (SPEC 7.1). Written to `<out>/results.json` by run.ts
// and re-rendered by the `report` command.
export interface CaseResult {
	id: string; // scenario id, or "load" / "bun-test"
	tier: "load" | "scripted" | "live";
	opencode: string; // resolved version label, e.g. "2.0.26"
	pass: boolean;
	skipped?: string; // reason, when the case did not run
	description?: string;
	failures?: string[];
	tools?: string[]; // tool names called (probe, post)
	steps?: number; // count of step_finish
	costUSD?: number;
	tokens?: { input: number; output: number };
	durationMs: number;
	textExcerpt?: string; // first 300 chars of text
	attempts?: { pass: boolean; failures: string[] }[]; // live only
	judge?: { pass: boolean; reason: string };
	kept?: string; // evidence dir
}

export interface ResultsFile {
	version: 1;
	at: string; // ISO timestamp of the run
	tool: string; // opencode-plugin-ci version
	plugin: string; // plugin package name (or path fallback)
	results: CaseResult[];
}
