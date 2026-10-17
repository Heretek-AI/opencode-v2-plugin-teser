# fixture-tui-broken

Proves a TUI entry that throws on import fails static tier 1.

- Importing `tui.ts` throws `Error("tui boom")`; the static check must fail.
