# fixture-tui-only

Proves TUI-only plugins get a static tier 1: `tui.ts` exports
`{ id: "fixture-tui", setup() {} }` and there is no server entry.

- Static tier 1 passes; tiers 2 and 3 are reported `skipped`.
