// Fixture: a shell.create.before hook that injects FIXTURE_ON=1 into the
// environment of every spawned shell.
export default {
	id: "fixture-shell-env",
	setup: async (ctx) => {
		await ctx.shell.hook("create.before", (i) => {
			if (i.env && typeof i.env === "object") {
				i.env.FIXTURE_ON = "1";
			} else {
				i.env = { FIXTURE_ON: "1" };
			}
		});
	},
};
