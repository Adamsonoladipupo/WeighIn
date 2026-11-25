# Fixture setup plan and typed setup bindings

This document describes how WeighIn executes fixture setup for contracts that
depend on each other (issue #213) and how a dependency's committed setup result
is passed into a later call (issue #215). It implements §2 and §3 of the
[fixture setup design](fixture-setup-design.md) for fixture contracts.

## Declaring dependencies

A contract lists the explicit `id`s of the contracts that must be committed
before it in `depends_on`. Before any account, RPC or deployment side effect,
`planSetupOrder` (`src/setup-plan.ts`) rejects:

- a dependency on an unknown id, or on a contract identified only by its path;
- a duplicate entry in one `depends_on` list;
- a contract that depends on itself;
- any dependency cycle (all contracts in the cycle are named);
- a binding to a contract that is not a declared dependency of the consumer.

The plan is a deterministic topological order. Ties keep fixture declaration
order, so a fixture without dependencies deploys exactly as before.

## Executing the plan

`runMeasurement` has two phases for each revision:

1. **Setup.** Every contract is uploaded and created once, in plan order, and
   each create transaction must be confirmed `SUCCESS` and return the expected
   deterministic contract address. An unexpected or missing address stops
   setup with a diagnostic containing the expected address and any observed
   address. The verified create return value is captured as raw ScVal XDR.
   When a contract has no `setup_invocations` and the instance already exists
   at the deterministic address, setup uses the verified instance address.
   When a contract declares `setup_invocations`, it deploys with a fresh random
   salt (refusing any pre-existing instance) and executes each declared setup
   invocation in order: building the call with literal or dependency-bound
   arguments, preparing via RPC, verifying only deployer source-account
   authorization is required, signing with the deployer keypair, submitting,
   and confirming `SUCCESS` inclusion before continuing to the next setup call
   or any dependent contract.
2. **Measurement.** Only after every deployment and every declared setup
   invocation across the whole fixture has committed are benchmark
   `invocations` simulated, in fixture declaration order. Setup transactions
   (upload, create, and `setup_invocations`) are never measured and their
   consumption is excluded from benchmark metrics.

If a prerequisite deployment or setup invocation fails, the run stops before
any remaining setup step or measured invocation and the error names every
transitive dependent that was aborted, for example
`Setup of id:callee failed; aborted dependents: id:caller`. Cancellation errors
are rethrown unchanged.

## Committed setup invocations

A contract can declare ordered `setup_invocations` to initialize on-chain state
before measured benchmark `invocations` run:

```json
{
  "id": "initialized-contract",
  "wasm_path": "target/wasm32v1-none/release/contract_test.wasm",
  "setup_invocations": [
    { "id": "seed", "function_name": "initialize", "args": [{ "type": "u32", "value": 30 }] },
    { "id": "increment", "function_name": "add", "args": [{ "type": "u32", "value": 12 }] }
  ],
  "invocations": [
    { "id": "read-committed", "function_name": "read_value", "args": [] }
  ]
}
```

Key guarantees and boundaries:

- **Preflight before side effects:** Unknown keys, blank IDs, duplicate setup
  IDs on one contract, bindings to undeclared dependencies, and invalid literal
  argument values fail before any key file creation, funding, or RPC call.
- **Ordered inclusion gate:** Each setup call fetches a fresh deployer account
  sequence, prepares via RPC, signs with the deployer keypair, submits, and
  waits for confirmed `SUCCESS` inclusion before the next step begins. Any
  preparation error, `ERROR`/`TRY_AGAIN_LATER`/invalid send status, `FAILED`
  transaction, or confirmation timeout halts the run before measurement.
- **Standalone authorization boundary:** Setup calls run only in the supported
  standalone environment with deployer source-account authorization
  (`sorobanCredentialsSourceAccount` or no auth). A prepared setup call
  requiring non-source-account authorization (such as
  `sorobanCredentialsAddress` for an external signer) fails closed before
  signing or submission. Signed production authorization is not claimed.
- **Metric and identity isolation:** Setup calls are never recorded in
  `benchmarks`, never alter benchmark `case_id`s, and never add setup CPU,
  memory, write entries, write bytes, or fees to benchmark metrics. Because
  contracts with `setup_invocations` deploy with a fresh salt per run, BASE and
  HEAD do not collide or double-initialize on a shared standalone network while
  still pairing by logical identity.
- **Source-built initialized contract:** `tests/fixtures/setup-invocations/`
  contains the contract source (`src/lib.rs`), locked Cargo manifest, and
  `fixtures.json`; the test scripts build its WASM into the ignored `target/`
  directory. The contract has no constructor, so benchmark reads (`read_value`,
  `check_value(42)`) fail unless `initialize(30)` and `add(12)` committed in
  order. `tests/setup-invocations.test.cjs` verifies success, ordering,
  signing, metric exclusion, cross-revision pairing, and invalid/failure cases;
  `tests/experiments/verify-setup-invocations.cjs` provides the explicit live
  standalone-network proof.

## Typed bindings

A top-level invocation argument can take a dependency's committed setup result
instead of a literal value:

```json
{ "type": "address", "binding": { "contract": "callee", "select": [] } }
```

`select` is an optional list of steps. `{ "field": "name" }` selects a map entry
whose symbol or string key is `name`, and `{ "index": n }` selects a vec
element. The selected ScVal must decode to the declared `type`. It is passed to
the invocation without lossy conversion, string interpolation or address
parsing. Resolution fails explicitly, naming the path, when:

- the dependency has no committed setup result, or its create returned no value;
- the captured return is not valid ScVal XDR;
- a field is missing, an index is out of range, or a step addresses the wrong
  container type (for example, an index into an address);
- the selected value's type differs from the declared type.

Case identity uses the binding declaration (`{"type":"address","binding":{...}}`)
rather than the runtime address. A redeployed dependency or changed WASM
therefore keeps the logical BASE/HEAD pairing. Measurement paths that have no
setup plan, such as source-account effect measurement, reject bound arguments
explicitly.

## Verification

- `tests/setup-plan.test.cjs` covers planning, schema validation, binding
  resolution, and plan execution through `runMeasurement` against a controlled
  RPC. The controlled-RPC tests check: dependency-first submission, one
  submission per deployment, the committed callee address reaching the caller
  as a typed `scvAddress`, dependents aborted after an upload failure, a
  malformed path or missing return failing before the dependent invocation,
  and invalid plans rejected before any key file is written.
- `tests/experiments/verify-setup-plan.cjs` is the explicit live proof against
  the pinned standalone network. It is excluded from `npm test`. It deploys the
  retained nested callee and caller WASMs (two different WASMs) from one
  fixture whose caller is declared first, binds the committed callee address
  into `run(callee, 1)`, and checks the real nested host call through the
  native footprint and return. It also runs live malformed-path and
  failed-prerequisite probes. Run it with a ready network and a built helper:

  ```bash
  npm run build && npm run build:helper
  node tests/experiments/verify-setup-plan.cjs docs/experiments/setup-plan
  ```

## Retained live evidence

The live proof passed on the pinned protocol-28 standalone Quickstart
(`LIVE_SETUP_PLAN_PROOF_PASS`, [verification](experiments/setup-plan/verification.json)):

- The callee (`7a8899…c070`) and the caller (`de3403…3f75`) are different WASMs
  and were deployed as distinct instances. The callee was uploaded and created
  first even though the caller is declared first, each deployment was submitted
  once, and all four setup transactions were confirmed `SUCCESS` before the
  first measured simulation ([setup receipts](experiments/setup-plan/setup-receipts.json)).
- The committed callee create return decodes to the callee address. The caller's
  measured `run` received exactly that ScVal XDR as its first argument. The
  native footprint of that single caller invocation includes the callee
  instance and writes the callee's `counter` entry, so the nested host call was
  real ([caller invocation](experiments/setup-plan/caller-invocation.json)).
- Live failure probes ([failure probes](experiments/setup-plan/failure-probes.json)):
  - An `index` selector on the address return failed with
    `$ is scvAddress, not a vec` before the caller was simulated.
  - A callee artifact that the network rejects at upload
    (`Error(WasmVm, InvalidAction)`) submitted nothing and aborted `id:caller`.

`tests/setup-plan.test.cjs` checks the retained files against `sha256.json`
and the WASM hashes on every `npm test`.
