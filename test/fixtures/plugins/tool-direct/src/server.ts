// Fixture: same as tool-basic, but with `options: { codemode: false }`, so the
// tool is offered to the model directly instead of through Code Mode.
export default {
	id: "fixture-tool-direct",
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
				options: { codemode: false },
				execute: async (input) => ({ content: `echo:${input.text}` }),
			});
		});
	},
};
