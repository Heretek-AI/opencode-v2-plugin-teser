// Fixture: adds echo_tool in Code Mode (the default) and returns "echo:<text>".
// The transform is idempotent: opencode re-runs transforms on reloads, so the
// tool is only added when it is not already registered.
export default {
	id: "fixture-tool-basic",
	setup: async (ctx) => {
		await ctx.tool.transform((editor) => {
			let existing = false;
			try {
				existing = editor.get("echo_tool") !== undefined;
			} catch {
				try {
					existing = editor.list().some((tool) => tool.id === "echo_tool");
				} catch {
					existing = false;
				}
			}
			if (existing) {
				return;
			}
			editor.add({
				name: "echo_tool",
				description: "Echo the input text back",
				input: {
					type: "object",
					properties: { text: { type: "string" } },
					required: ["text"],
				},
				execute: async (input) => ({ content: `echo:${input.text}` }),
			});
		});
	},
};
