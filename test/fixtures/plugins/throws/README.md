# fixture-throws

Proves load failures are reported: `setup` throws `Error("fixture boom")`.

- Tier 1 must fail with `fixture boom` in the failure text (inventory status
  `failed`, plus a `failed to load plugin` stderr line).
- `smoke.yaml` only documents the shape of a run against this fixture; it can
  never pass while `setup` throws.
