# WeighIn Fixture Documentation

WeighIn uses `weighin-fixtures.json` to define the Soroban contracts and
function invocations that should be measured.

A fixture can contain multiple contracts, and each contract can contain
multiple function invocations.

The runtime schema is defined in `src/config.ts` through
`FixturesSpecSchema`, `ContractSpecSchema`, `InvocationSpecSchema` and
`InvocationArgSchema`.

The published editor schema is generated from these same Zod declarations:
[`schemas/weighin-fixtures.schema.json`](schemas/weighin-fixtures.schema.json).

## 1. Top-level structure

A fixture has the following structure:

```json
{
  "id": "optional-fixture-id",
  "contracts": [
    {
      "id": "optional-contract-id",
      "wasm_path": "path/to/contract.wasm",
      "depends_on": [],
      "invocations": [
        {
          "id": "optional-invocation-id",
          "function_name": "hello",
          "args": []
        }
      ]
    }
  ]
}
