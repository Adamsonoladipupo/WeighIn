# Fixture JSON Schema

The editor schema is published at [`schemas/weighin-fixtures.schema.json`](schemas/weighin-fixtures.schema.json) and is generated from the same Zod declarations used by `parseFixtures`. It describes the input file; WeighIn adds logical identity fields to parsed results.

## Valid example

```json
{
  "id": "greeting-suite",
  "contracts": [
    {
      "id": "greeting",
      "wasm_path": "contract/target/wasm32v1-none/release/contract.wasm",
      "invocations": [
        {
          "id": "hello-world",
          "function_name": "hello",
          "args": [{ "type": "symbol", "value": "world" }]
        }
      ]
    }
  ]
}
```

## Invalid example

This file is rejected because the contract ID is blank:

```json
{
  "contracts": [
    {
      "id": "   ",
      "wasm_path": "contract.wasm",
      "invocations": [{ "function_name": "hello", "args": [] }]
    }
  ]
}
```

Explicit fixture, contract, and invocation IDs resolve to `fixture_id`, `logical_id`, and `case_id`. Without an explicit ID, the runtime derives these identities from the normalized fixture path, WASM path, or canonicalized typed arguments respectively. Contracts may also declare `depends_on` (explicit dependency contract IDs) and ordered `setup_invocations` (prepared, signed by the deployer, submitted, and confirmed before measured `invocations` run, with setup consumption excluded from benchmark metrics; see `tests/fixtures/setup-invocations/fixtures.json` and [setup plan](setup-plan.md)). Editor validation checks the declaration shape; runtime validation remains authoritative for type-specific argument values and Soroban conversion.
