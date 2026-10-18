# fixture-no-entry

Proves a plugin directory with no loadable server entry is a configuration
error: `package.json` has no `exports` or `main`, and there is no
`server.*` or `index.*` at the root (`src/helper.ts` is not an entry).

- `validate`/`run` must exit 2 with a clear "no server entry" message.
