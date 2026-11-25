# Benchmarking Soroban DeFi Operations

This tutorial shows how to compare the resource footprint of AMM swaps and
liquidity-pool deposits and withdrawals across BASE and HEAD revisions with
WeighIn. It assumes the contract has already been implemented and that you can
build it using WeighIn's supported contract build flow.

WeighIn's documented measurement path uses a compatible standalone Stellar
RPC endpoint; it is not a mainnet benchmarking service. See the [CLI
reference](CLI.md), [fixture schema](fixture-schema.md), and [metric
definitions](METRICS.md) for details.

## 1. Declare the operations

Create `weighin-fixtures.json` with stable IDs so WeighIn compares the same
contract and invocation cases across revisions:

```json
{
  "id": "amm-pool-benchmarks",
  "contracts": [
    {
      "id": "amm-pool",
      "wasm_path": "contract/target/wasm32v1-none/release/amm_pool.wasm",
      "invocations": [
        {
          "id": "swap-token-a-for-b",
          "function_name": "swap",
          "args": [
            { "type": "address", "value": "REPLACE_WITH_TOKEN_A_ADDRESS" },
            { "type": "address", "value": "REPLACE_WITH_TOKEN_B_ADDRESS" },
            { "type": "i128", "value": "1000000" },
            { "type": "i128", "value": "950000" }
          ]
        },
        {
          "id": "deposit-balanced",
          "function_name": "deposit",
          "args": [
            { "type": "i128", "value": "1000000" },
            { "type": "i128", "value": "1000000" },
            { "type": "i128", "value": "990000" }
          ]
        },
        {
          "id": "withdraw-liquidity",
          "function_name": "withdraw",
          "args": [
            { "type": "i128", "value": "1000000" },
            { "type": "i128", "value": "990000" },
            { "type": "i128", "value": "990000" }
          ]
        }
      ]
    }
  ]
}
```

This is an illustrative interface, not a universal AMM ABI. Replace the
address placeholders with valid Stellar addresses and change the argument
count, order, and types to match your contract's exported methods. Integer
arguments use decimal strings to preserve precision. The example uses
`i128`; use the types and bounds your contract actually accepts.

The fixture file must be available at the same relative path in both
revisions. Keep its explicit fixture, contract, and invocation IDs stable. If
the operations or their intended meanings change, assign new invocation IDs
instead of comparing unlike cases.

## 2. Establish the initial pool state

Each configured benchmark invocation is simulated independently. The
invocation's simulated writes are not submitted or carried over to the next
case. Prepare the required token balances, approvals, pool reserves, and
authorization context in the standalone network before running WeighIn.
Otherwise a fixture may fail for lack of state, or measure a different path
than intended.

WeighIn deploys or reuses the benchmark WASM as part of measurement, but it
does not seed arbitrary AMM state for you. Make BASE and HEAD start from
equivalent initial state and network configuration. Measure realistic
amounts, including edge cases such as a small swap, a large swap, and an
imbalanced deposit, as separate explicitly identified cases if those paths
matter.

## 3. Run a BASE/HEAD comparison

In the GitHub Action, the pull request workspace supplies HEAD. WeighIn fetches
the target BASE ref from `origin`, builds each revision from its own fixture
and source, simulates its invocations through the configured Soroban RPC, and
compares the resulting records.

The standalone CLI measures only its supplied fixtures; use it for an
individual measurement, not as a substitute for the Action's full
BASE/HEAD workflow:

```bash
weighin ./weighin-fixtures.json ./amm-results.json \
  --rpc-url http://localhost:8000/rpc
```

For CI threshold examples, configure `weighin.toml`. Relative rules compare
HEAD with BASE; absolute limits constrain HEAD consumption:

```toml
[thresholds.functions.swap]
cpu_instructions = "allow_2_percent_increase"
ledger_write_entries = "strict_zero_tolerance"
ledger_write_bytes = "allow_2_percent_increase"

[thresholds.functions.deposit]
cpu_instructions = "allow_5_percent_increase"
ledger_write_entries = "strict_zero_tolerance"

[thresholds.functions.withdraw]
cpu_instructions = "allow_5_percent_increase"
ledger_write_entries = "strict_zero_tolerance"

[limits.functions.swap]
# Project budget example only; confirm against captured RPC limits.
memory_bytes = 32000000
```

The memory value is a project policy example, not a universal Soroban limit.
Choose thresholds from repeatable measurements and leave headroom for
production inputs and network configuration. See the [configuration
reference](CONFIGURATION.md) and [DeFi budget example](examples/defi-budget.toml)
for policy semantics.

## 4. Interpret the report

Review the measured metrics most relevant to each operation:

| Metric | DeFi interpretation |
|---|---|
| `cpu_instructions` | Computational cost of pricing, invariant checks, routing, and authorization |
| `memory_bytes` | Metered simulation memory; monitor independently of CPU |
| `ledger_read_entries` | Distinct read-only and read-write footprint keys |
| `ledger_read_bytes` | Classic-ledger disk-read bytes under WeighIn's audited mapping |
| `ledger_write_entries` | Read-write footprint keys, including no-op writes and deletions |
| `ledger_write_bytes` | Encoded read-write postimages; deletions add no postimage bytes |
| `event_data_bytes` | Successful event XDR plus the top-level return-value XDR |

Positive deltas mean HEAD uses more of that resource. Check the invocation
identity and both BASE/HEAD values before treating a change as a regression.
Unavailable metrics are explicitly marked and must not be interpreted as zero.
Metric names, caps, and limitations are explained in [Metric
Provenance](metric-provenance.md).

## 5. Keep comparisons meaningful

- Keep the Soroban protocol, RPC network, fixture inputs, and initial ledger
  state equivalent between revisions.
- Use explicit IDs for benchmark cases whose arguments or labels may evolve.
- Compare the same meaningful workload rather than changing test amounts and
  implementation in one revision.
- Treat absolute limits as project budgets; network caps are captured from
  the RPC snapshot and can change.
- A simulated swap, deposit, or withdrawal does not persist its benchmark
  writes or measure the fee of submitting a signed production transaction.
