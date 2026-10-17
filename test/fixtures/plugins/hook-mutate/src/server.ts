// Fixture: an execute.before hook that redacts the word "secret" from shell
// commands, replacing it with "[x]". The pre probe records the original
// input; the post probe records the mutated input.
export default {
	id: "fixture-hook-mutate",
	setup: async (ctx) => {
		await ctx.tool.hook("execute.before", (i) => {
			if (i.tool !== "shell") {
				return;
			}
			const input = i.input;
			if (input !== null && typeof input === "object" && "command" in input) {
				const record = input as Record<string, unknown>;
				if (typeof record.command === "string") {
					record.command = record.command.replaceAll("secret", "[x]");
				}
			}
		});
	},
};
