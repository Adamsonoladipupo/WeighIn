# Benchmarking Soroban Contract Upgrades

This guide covers how to compare the resource cost of a contract's upgrade
entrypoint across revisions and how to reason about migration overhead with
WeighIn.

## What the benchmark measures

WeighIn fixtures invoke exported contract functions. A contract upgrade is
normally exposed as an authorized application entrypoint (often named
`upgrade`) that calls Soroban's `update_current_contract_wasm` host function
with a new WASM hash. `upgrade_wasm` is not a universal fixture method name:
use the actual exported method in your contract.

WeighIn simulates each benchmark invocation and captures resource usage; its
benchmark invocation writes are not submitted or carried into another case.
This measures the simulated upgrade or migration call's CPU, memory, footprint,
IO, and event resources. It does not by itself persist the new code, perform a
multi-transaction rollout, measure wall-clock downtime, or calculate the fee
for submitting a signed production transaction.

## Fixture example

The following assumes an exported `upgrade` method accepting a 32-byte WASM
hash as `BytesN<32>`. WeighIn represents that argument using the `bytes` type
with a hexadecimal string. Replace the example hash with the intended target
WASM hash and adapt the method and arguments to the contract's interface:

```json
{
  "id": "contract-upgrade-benchmarks",
  "contracts": [
    {
      "id": "vault",
      "wasm_path": "contract/target/wasm32v1-none/release/vault.wasm",
      "invocations": [
        {
          "id": "upgrade-to-v2",
          "function_name": "upgrade",
          "args": [
            {
              "type": "bytes",
              "value": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            }
          ]
        }
      ]
    }
  ]
}
```

The sample hash is syntactically valid but is only a placeholder; it must
identify the target WASM that the upgrade code expects. Generate the artifact
hash according to your contract's upgrade flow, for example:

```bash
sha256sum contract/target/wasm32v1-none/release/vault.wasm
```

The target WASM must already be uploaded to the standalone network so its
contract-code entry exists when the upgrade is simulated. The fixture's hash
argument does not upload that target artifact; prepare it and the required
authorization/state before benchmarking.

If BASE and HEAD intentionally upgrade to different WASM artifacts, keep the
fixture, contract, and invocation IDs stable in each revision while setting
the corresponding target hash for that revision's scenario. Compare only
scenarios with the same upgrade semantics. See the [fixture
schema](fixture-schema.md) for typed argument syntax and stable identities.

The invocation also needs the authorization and ledger state required by
your contract's upgrade policy. Prepare equivalent state for BASE and HEAD
on the standalone network; WeighIn does not automatically create application
administrators or migrate arbitrary contract storage.

## Include migration work explicitly

If an upgrade performs storage migration in the same invocation, the measured
cost includes that work when the simulation executes the migration path. If
migration is exposed as a separate exported method, add an invocation for it
with a distinct stable ID, or benchmark the exact application workflow using
the contract's supported setup and dependency mechanism.

Do not assume writes from one benchmark invocation become the starting state
of the next. WeighIn isolates benchmark simulations; model a migration that
depends on prior state with equivalent prepared state for each revision. If
the migration is split across submitted transactions in production, benchmark
each important transaction path and account for their cumulative resource
budget separately.

## Compare revisions and enforce budgets

The GitHub Action measures the BASE and HEAD revision using their respective
fixtures and WASM artifacts, then reports metric deltas. Keep the fixture path
and explicit identities consistent across revisions. The standalone CLI can
measure an existing WASM, but it does not run the full GitHub BASE/HEAD
comparison:

```bash
weighin ./weighin-fixtures.json ./upgrade-results.json \
  --rpc-url http://localhost:8000/rpc
```

Example policy for an upgrade operation:

```toml
[thresholds.functions.upgrade]
cpu_instructions = "allow_5_percent_increase"
ledger_write_entries = "strict_zero_tolerance"
ledger_write_bytes = "allow_5_percent_increase"

[limits.functions.upgrade]
cpu_instructions = 300000000
```

Tune these application budgets from your measured results and the limit
captured by the configured RPC network. They are not universal Soroban
protocol limits. Watch write-entry and write-byte changes when a migration
touches persistent state; also monitor CPU and memory for data-dependent
migration loops. WeighIn's metric definitions and cap mappings are in [Metric
Provenance](metric-provenance.md), and policy semantics are in the
[Configuration Reference](CONFIGURATION.md).
