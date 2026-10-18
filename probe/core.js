import { appendFileSync } from "node:fs";

const SECRET_KEY = /KEY|TOKEN|SECRET|PASSWORD|AUTH|COOKIE/i;
const MAX = 4000;
const SYSTEM_MAX = 50000; // system parts are long; plugin additions often land at the end

function clip(value, depth = 0, max = MAX) {
	if (typeof value === "string") {
		return value.length > max
			? `${value.slice(0, max)}…[+${value.length - max}]`
			: value;
	}
	if (value === null || typeof value !== "object") return value;
	if (depth > 6) return "[depth]";
	if (Array.isArray(value)) {
		return value.slice(0, 200).map((item) => clip(item, depth + 1, max));
	}
	const out = {};
	for (const [key, item] of Object.entries(value)) {
		out[key] = clip(item, depth + 1, max);
	}
	return out;
}

function redactEnv(env) {
	const out = {};
	for (const [key, value] of Object.entries(env ?? {})) {
		out[key] = SECRET_KEY.test(key) && value ? "[redacted]" : value;
	}
	return out;
}

/** Deep-copies at record time: later plugins mutate the same object. */
function snapshot(value) {
	try {
		return JSON.parse(JSON.stringify(value));
	} catch {
		return String(value);
	}
}

const rows = (json) =>
	Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
const safe = async (fn) => {
	try {
		return await fn();
	} catch (error) {
		return { error: String(error) };
	}
};

export function makeProbe(phase) {
	let seq = 0;
	let inventoryDone = false;
	return {
		id: `opencode-plugin-ci.probe.${phase}`,
		setup: async (ctx) => {
			const out = ctx.options?.out;
			if (!out) return;
			// Metadata goes LAST so a payload field can never overwrite `kind`/`phase`.
			const write = (kind, data, max = MAX) =>
				appendFileSync(
					out,
					`${JSON.stringify({ ...clip(snapshot(data), 0, max), phase, seq: seq++, t: Date.now(), kind })}\n`,
				);

			write("setup", { ctxKeys: Object.keys(ctx) });

			await ctx.tool.hook("execute.before", (i) =>
				write("tool.before", {
					tool: i.tool,
					callID: i.id,
					input: i.input,
				}),
			);
			await ctx.tool.hook("execute.after", (i) =>
				write("tool.after", {
					tool: i.tool,
					callID: i.id,
					status: i.status,
					input: i.input,
					result: i.result,
					error: i.error,
				}),
			);
			await ctx.shell.hook("create.before", (i) =>
				write("shell.before", {
					command: i.command,
					cwd: i.cwd,
					shell: i.shell,
					env: redactEnv(i.env),
				}),
			);
			await ctx.session.hook("prompt", async (i) => {
				write("session.prompt", { prompt: i.prompt });
				if (phase !== "post" || inventoryDone) return;
				inventoryDone = true;
				write("inventory", {
					plugins: rows(await safe(() => ctx.plugin.list())).map((p) => ({
						id: p.id,
						source: p.source,
						status: p.state?.status,
						error: p.state?.error,
					})),
					tools: (await safe(() => ctx.tool.list())).map?.((t) => t.id) ?? [],
					commands: rows(await safe(() => ctx.command.list())).map(
						(c) => c.name,
					),
					agents: rows(await safe(() => ctx.agent.list())).map(
						(a) => a.id ?? a.name,
					),
					skills: rows(await safe(() => ctx.skill.list())).map(
						(s) => s.id ?? s.name,
					),
					mcp: rows(await safe(() => ctx.mcp.list())).map(
						(m) => m.name ?? m[0],
					),
				});
			});
			await ctx.session.hook("context", (i) =>
				write(
					"session.context",
					{
						agent: i.agent,
						// One string per system part, so an appended part survives clipping of a long base prompt.
						system: (i.system ?? []).map((part) =>
							typeof part === "string"
								? part
								: (part.text ?? JSON.stringify(part)),
						),
						tools: Object.keys(i.tools ?? {}),
						messageCount: i.messages?.length ?? 0,
					},
					SYSTEM_MAX,
				),
			);
			await ctx.session.hook("model.request", (i) =>
				// `requestKind`, not `kind`: `kind` is the record type.
				write("session.model.request", {
					requestKind: i.kind,
					model: i.model,
					baseURL: i.baseURL,
					headers: redactEnv(i.headers),
				}),
			);

			if (phase === "post") {
				void (async () => {
					try {
						for await (const ev of ctx.event.subscribe()) {
							write("event", { type: ev?.type });
						}
					} catch (error) {
						write("event.error", { error: String(error) });
					}
				})();
			}
		},
	};
}
