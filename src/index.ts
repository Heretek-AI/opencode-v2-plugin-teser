// Public programmatic API for `bun:test` users (SPEC 5.3): the primitives
// the runner itself uses, so authors who outgrow YAML can assert directly.

export type { Evidence } from "./assert/expect.ts";
export { evaluate } from "./assert/expect.ts";
export { check } from "./assert/matchers.ts";
export type { ResolvedOpencode } from "./opencode/binary.ts";
export { resolveOpencode } from "./opencode/binary.ts";
export type {
	InnerToolCall,
	RunEvent,
	RunEventError,
	RunEventPart,
	ToolCallState,
	ToolUse,
	Usage,
} from "./opencode/events.ts";
export {
	errors,
	parseEvents,
	textOf,
	toolUses,
	usage,
} from "./opencode/events.ts";
export type { Entries } from "./plugin/entry.ts";
export { ensureEntriesOrThrow, resolveEntries } from "./plugin/entry.ts";
export { writeShim } from "./plugin/shim.ts";
export type {
	InventoryPlugin,
	ProbeInventory,
	ProbeRecord,
	ToolCallPair,
} from "./probe/read.ts";
export { ProbeLog, probePluginDirs, readProbe } from "./probe/read.ts";
export { appendStepSummary, renderMarkdown } from "./report/markdown.ts";
export type { CaseResult, ResultsFile } from "./report/results.ts";
export type { RunOptions, RunOutcome, TierName } from "./run.ts";
export { runCi } from "./run.ts";
export type {
	RunOutput,
	SandboxOptions,
	SandboxPlugin,
	SandboxRunOptions,
} from "./sandbox/sandbox.ts";
export { Sandbox } from "./sandbox/sandbox.ts";
export type {
	Recorded,
	RequestKind,
	Step,
	Stub,
	StubOptions,
	ToolCall,
} from "./stub/stub.ts";
export { EXHAUSTED, JUDGE_SENTINEL, startStub } from "./stub/stub.ts";
export type {
	JudgeEvidenceSections,
	JudgeOutcome,
	RunJudgeOptions,
	Verdict,
} from "./tiers/judge.ts";
export {
	buildJudgePrompt,
	JUDGE_AGENT,
	JUDGE_SYSTEM,
	parseVerdict,
	runJudge,
} from "./tiers/judge.ts";
export type {
	LiveBudget,
	ResolveModelOptions,
	RunLiveScenarioOptions,
} from "./tiers/live.ts";
export {
	budgetExhaustedReason,
	collectLiveKeys,
	noKeySkipReason,
	resolveModel,
	runLiveScenario,
} from "./tiers/live.ts";
