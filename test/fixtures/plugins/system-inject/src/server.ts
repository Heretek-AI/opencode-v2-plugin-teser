// Fixture: a session context hook that appends a marker part to the system
// prompt, so the stub-recorded request carries FIXTURE-SYSTEM.
export default {
	id: "fixture-system-inject",
	setup: async (ctx) => {
		await ctx.session.hook("context", (i) => {
			i.system.push({ type: "text", text: "FIXTURE-SYSTEM" });
		});
	},
};
