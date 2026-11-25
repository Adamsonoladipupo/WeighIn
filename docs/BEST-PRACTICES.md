
# Soroban resource budgeting best practices

This guide explains how to use WeighIn to establish and enforce resource budgets for Soroban contracts, including DeFi operations such as swaps, deposits, withdrawals, liquidations and multi-hop routing.

WeighIn compares resource measurements between BASE and HEAD. It helps detect regressions during development; it is not a transaction fee estimator, a substitute for protocol limits, or a guarantee that a transaction will succeed under every network state.

For the exact meaning and provenance of each metric, see [Metrics](METRICS.md) and the existing [metric provenance audit](metric-provenance.md).

## 1. Establish a reproducible baseline first

Before introducing strict budgets:

1. Commit the benchmark fixtures to the baseline revision.
2. Use stable fixture, contract and invocation IDs.
3. Measure the same logical operations on BASE and HEAD.
4. Keep the supported network, protocol, native helper and measurement environment consistent.
5. Review the actual metric values and provenance before choosing limits.

A benchmark should represent a meaningful contract operation rather than an arbitrary function call.

For a DeFi protocol, useful benchmark cases may include:

| Operation | Example workload |
|---|---|
| Swap | A single-pool token swap |
| Multi-hop swap | A route that traverses multiple pools |
| Deposit | Adding liquidity or collateral |
| Withdraw | Removing liquidity or collateral |
| Borrow | Creating or increasing a loan |
| Repay | Repaying an outstanding loan |
| Liquidation | Liquidating an eligible position |
| Position update | Updating collateral or debt state |

Use stable case IDs to distinguish different workloads that call the same contract function.

## 2. Start with targeted policies

A useful initial policy focuses on the resources that matter most to the operation.

For example:

```toml
[thresholds.functions.swap]
cpu_instructions = "allow_2_percent_increase"
ledger_write_entries = "strict_zero_tolerance"

[limits.functions.swap]
memory_bytes = 32000000
```

This example means:

- CPU instructions may increase by up to 2% from BASE.
- Any increase in write footprint entries fails.
- HEAD memory consumption must not exceed the configured absolute cap.

The memory value is an illustrative application budget. It must be validated against the project's measurements and the supported network's captured resource configuration before adoption.

Function-level rules apply to all matched benchmarks with the same `function_name`. They are not limited to one contract, fixture or case ID.

## 3. Use strict zero tolerance selectively

`strict_zero_tolerance` rejects any positive increase in the selected metric.

It is useful when even a small increase is unacceptable, for example:

- An unexpected additional ledger write entry.
- A storage access that should not be introduced by a change.
- A critical operation with a deliberately fixed resource budget.

Do not apply zero tolerance indiscriminately to every metric. Small changes in CPU or memory may be legitimate consequences of compiler, SDK or implementation changes. Establish the expected variation first.

A strict rule is a policy decision, not proof that the underlying operation is incorrect.

## 4. Set percentage allowances from measured behaviour

WeighIn supports:

- `strict_zero_tolerance`
- `allow_X_percent_increase`
- A non-negative numeric percentage
- `ignore`

For example:

```toml
[thresholds.functions.swap]
cpu_instructions = "allow_2_percent_increase"
memory_bytes = "allow_5_percent_increase"
```

A percentage allowance compares HEAD consumption with BASE consumption. Equality at the configured allowance passes. A larger increase fails.

Do not choose a percentage because it looks small. Choose it using repeated measurements and an understanding of the operation's expected variability.

A zero BASE value followed by positive HEAD consumption violates a finite percentage allowance.

## 5. Understand absolute limits versus regression thresholds

A regression threshold answers:

> How much may this operation increase compared with BASE?

An absolute limit answers:

> How much resource may HEAD consume at most?

For example:

```toml
[limits.functions.swap]
cpu_instructions = 500000
memory_bytes = 32000000
```

The numbers above are illustrative policy values, not universal Stellar protocol limits.

Absolute caps are evaluated against matched BASE/HEAD benchmarks. New or removed cases alone do not evaluate absolute caps. A configured global cap fails if there are no matched benchmarks.

Prefer an absolute cap when an operation must remain below a known application budget, and a relative threshold when the important requirement is preventing regressions from the established baseline.

## 6. Budget memory deliberately

WeighIn's `memory_bytes` metric is the native Soroban simulation memory consumption value. It is not the operating system's process RSS or a measurement of the GitHub runner's RAM.

The network's transaction memory limit is captured as a resource limit. An application-level memory cap should leave sufficient headroom below the applicable network limit.

When selecting a cap:

1. Measure representative normal and worst-case workloads.
2. Review the captured memory limit in the benchmark provenance.
3. Set a project budget below the applicable limit.
4. Re-measure after changing SDK, protocol or helper versions.
5. Avoid treating a single successful sample as a universal worst-case guarantee.

Do not copy an absolute memory value from another protocol or network without verifying its applicability.

## 7. Understand ledger reads and writes

Ledger footprint entries, disk-read bytes and write bytes describe different resource dimensions.

- `ledger_read_entries` counts distinct read-only plus read-write footprint keys.
- `ledger_write_entries` counts read-write footprint keys.
- `ledger_read_bytes` represents the supported path's measured disk-read bytes; live Soroban in-memory reads are not equivalent to classic ledger disk reads.
- `ledger_write_bytes` represents encoded read-write postimages under the audited measurement path.

A function can increase its write-entry count without a proportional increase in write bytes. Likewise, fewer entries do not automatically mean fewer bytes.

For DeFi operations, inspect both entry counts and byte consumption when evaluating storage changes.

## 8. Treat events and return values as a resource budget

The `event_data_bytes` metric includes successful non-diagnostic contract event XDR sizes plus the top-level return value's XDR size.

This means a change can increase the metric by:

- Emitting more events.
- Emitting larger event payloads.
- Returning a larger value.
- Changing the encoded structure of events or the return value.

`events_count` is measured, but protocol 28 has no independent event-count cap in the current WeighIn mapping. Its measured value can still be used in a project policy.

For contracts that emit events for every route hop or position update, monitor both event count and encoded event/return bytes.

## 9. Do not confuse metrics with fee estimates

Soroban resource fees are calculated from declared transaction resources and network fee settings. The actual fee depends on the applicable network configuration and fee rates.

WeighIn measures selected simulation resource values. It does not calculate a final transaction fee in XLM.

In particular:

- CPU instructions contribute to resource fee calculation.
- Ledger entry access and ledger I/O contribute to resource fee calculation.
- Transaction size contributes to resource fee calculation, but WeighIn's `tx_size_bytes` metric is currently unavailable.
- Event and return-value size contribute to resource fee calculation.
- Memory is a resource limit, but it is not itself a separately charged fee component in the documented fee model.

See [Metrics](METRICS.md) and Stellar's [Fees, Resource Limits, and Metering](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering).

## 10. Keep the benchmark environment comparable

A resource comparison is meaningful only when the measurement provenance is compatible.

WeighIn validates important environment fields, including protocol, network, helper identity, compute configuration and metric-specific provenance.

For reliable comparisons:

- Use the supported standalone protocol-28 network.
- Use the pinned native helper and supported toolchain.
- Keep fixture arguments and logical identities stable.
- Do not compare records from incompatible schema versions.
- Re-measure both revisions when the measurement environment changes.
- Review unavailable metrics instead of interpreting `null` as zero.

BASE and HEAD can still observe different ledger states. A passing comparison is evidence for the measured cases and environment, not a proof of universal determinism.

## 11. Treat unavailable metrics explicitly

The current implementation marks these metrics unavailable:

- `historical_data_read_bytes`
- `contract_data_hard_limit`
- `tx_size_bytes`

They are represented by `null` consumption and an explanatory reason. They are not measured zeros.

A policy that requires an unavailable metric fails closed. If a global policy such as `fail_on_any_regression = true` is enabled, explicitly ignore unavailable metrics for the affected functions where that is the intended policy.

Do not invent values or substitute a different resource measurement under one of these metric names.

## 12. Recommended review checklist

Before merging a resource-budget change, review:

- [ ] The fixture represents the intended production-like operation.
- [ ] BASE and HEAD use stable logical benchmark identities.
- [ ] The comparison uses compatible protocol and measurement provenance.
- [ ] CPU and memory deltas are understood.
- [ ] Ledger read/write entry and byte deltas are understood.
- [ ] Event and return-value byte changes are understood.
- [ ] Absolute caps leave sufficient headroom below applicable network limits.
- [ ] Percentage allowances are supported by measured behaviour.
- [ ] Unavailable metrics are not mistaken for zero.
- [ ] A passing benchmark is not described as a guaranteed transaction fee or universal execution guarantee.

## Further reading

- [WeighIn metric definitions](METRICS.md)
- [WeighIn metric provenance audit](metric-provenance.md)
- [WeighIn known limitations](KNOWN_LIMITATIONS.md)
- [WeighIn network readiness](network-readiness.md)
- [Stellar: Fees, Resource Limits, and Metering](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering)
- [Stellar Protocol CAP-0046](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0046-07.md)
