# Soroban Resource Limits and Safety Margins

Soroban transactions are constrained by multiple resources, not just CPU.
WeighIn reports measured resource consumption alongside the corresponding
limits decoded from the same captured network configuration.

## Network limits are configurable

Stellar resource limits are set through network configuration and may change
by protocol version, network, and validator-approved updates. There is no
single timeless set of numeric limits that applies to every network. Stellar's
[Fees, Resource Limits, and Metering](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering)
documentation points users to [Stellar Lab's Network Limits](https://lab.stellar.org/network-limits)
for current network values.

The table below gives the **protocol-28 reference values in WeighIn's
captured metric-provenance snapshot**, not a promise about current Mainnet or
another RPC endpoint. The snapshot is protocol 28 and `soroban-simulation`
28.0.1. During a real measurement, rely on the limit stored with that
invocation's metric, not these illustrative values.

| Resource | Protocol-28 reference limit | Soroban configuration setting | What it bounds |
|---|---:|---|---|
| CPU instructions per transaction | 400,000,000 | `ConfigSettingContractComputeV0.txMaxInstructions` | Metered Soroban CPU cost-model instructions |
| Memory per transaction | 41,943,040 bytes (40 MiB) | `ConfigSettingContractComputeV0.txMemoryLimit` | Metered simulation memory; not process RSS |
| Total footprint entries | 400 | `ConfigSettingContractLedgerCostExtV0.txMaxFootprintEntries` | Distinct read-only plus read-write ledger keys |
| Disk-read bytes per transaction | 200,000 bytes | `ConfigSettingContractLedgerCostV0.txMaxDiskReadBytes` | Classic-ledger entry bytes read under the audited mapping |
| Write-footprint entries | 200 | `ConfigSettingContractLedgerCostV0.txMaxWriteLedgerEntries` | Distinct read-write footprint keys |
| Write bytes per transaction | 132,096 bytes | `ConfigSettingContractLedgerCostV0.txMaxWriteBytes` | Encoded read-write postimages |
| Contract events and return data | 16,384 bytes | `ConfigSettingContractEventsV0.txMaxContractEventsSizeBytes` | Successful event XDR plus top-level return-value XDR in WeighIn's metric |

The reference values are also recorded in the metric-provenance
[measurement data](experiments/metric-provenance/measurements.json). The
corresponding settings are decoded from captured configuration entries; the
full mapping is documented in [Metric Provenance](metric-provenance.md).

Some similarly named resources are not interchangeable. In particular,
`ledger_read_entries` is the distinct RO+RW footprint count, while
`ledger_read_bytes` is disk-read bytes, not a count of all live Soroban
storage reads. `ledger_write_entries` counts RW footprint keys; `ledger_write_bytes`
counts encoded postimages. WeighIn's `events_count` has no independent event
count cap in protocol 28, while `event_data_bytes` is compared with the
combined event/return-data byte cap.

## How WeighIn helps manage headroom

For each measured invocation, WeighIn records both `consumed` and `limit`
where the supported protocol mapping provides them. It compares BASE and HEAD
measurements, computes absolute and percentage deltas, and can enforce:

- Relative regression rules such as `strict_zero_tolerance` or a permitted
  percentage increase.
- Absolute project budgets for global, function, or aggregate benchmarks.

For example:

```toml
[thresholds.functions.swap]
cpu_instructions = "allow_5_percent_increase"
ledger_write_entries = "strict_zero_tolerance"

[limits.functions.swap]
cpu_instructions = 300000000
ledger_write_bytes = 100000
```

These are application policy values, not protocol configuration. Choose them
below the observed network cap to preserve margin for input variation and
future changes. A passing BASE/HEAD comparison alone does not establish that
either version is safely below a network limit; review HEAD consumption
against the captured `limit` too.

Unavailable metrics are represented by null values and a reason, not as zero.
For example, the current schema does not measure signed transaction size or
historical data read consumption. See [Metrics](METRICS.md) for definitions
and [Configuration](CONFIGURATION.md) for rule behavior.

## Safety-margin workflow

1. Measure representative and worst-case inputs on the same standalone
   protocol/network configuration.
2. Check HEAD consumption against each corresponding captured cap, not just
   its BASE delta.
3. Set project limits with room for input growth and protocol/network changes.
4. Track important resources across revisions with relative thresholds.
5. Re-measure after a protocol upgrade or network-configuration change; the
   BASE and HEAD captures must have compatible resource-limit identities for
   a valid comparison.

WeighIn's verified measurement path is Linux x64 and protocol 28. Limits are
read from captured configuration at runtime; WeighIn does not substitute a
hard-coded Mainnet cap when the capture does not provide one.
