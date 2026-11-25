
# WeighIn metrics and Soroban resource fees

WeighIn measures Soroban transaction resource usage so contract authors can review resource changes between BASE and HEAD.

The measurements describe Soroban simulation resources. They are not measurements of physical CPU instructions, process memory usage, disk hardware activity or a final signed transaction fee.

The supported measurement path documented by this repository is Linux x64, a standalone protocol-28 network, the pinned native Soroban simulation helper and the corresponding captured network configuration.

For the audited source mapping and exact provenance labels, see [Metric provenance](metric-provenance.md).

## 1. Soroban resource fee overview

Stellar transactions pay an inclusion fee. Smart contract transactions also pay a resource fee.

At a high level:

```text
Total transaction fee
    = Inclusion fee
    + Soroban resource fee
```

The resource fee depends on the transaction's declared resource usage and the network's fee configuration. It is not a fixed price per contract function.

The Soroban resource fee model accounts for several dimensions:

- CPU instructions.
- Ledger entry accesses.
- Ledger data read and written.
- Transaction envelope size.
- Contract event and return-value size.

Network fee rates and resource limits can change. The applicable values must be read from the network configuration rather than copied from a historical example.

Stellar's official [Fees, Resource Limits, and Metering](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering) documentation describes the fee model, resource limits and simulation workflow.

## 2. Metric availability in WeighIn

The current measurement schema defines eleven metric keys.

| Metric key | Display meaning | Current availability |
|---|---|---|
| `cpu_instructions` | Soroban CPU cost-model instructions | Measured |
| `memory_bytes` | Soroban simulation memory consumption | Measured |
| `ledger_read_entries` | Distinct read-only plus read-write footprint entries | Measured |
| `ledger_read_bytes` | Disk-read bytes under the audited measurement mapping | Measured |
| `ledger_write_entries` | Read-write footprint entries | Measured |
| `ledger_write_bytes` | Encoded read-write postimage bytes | Measured |
| `historical_data_read_bytes` | Historical-data read consumption | Unavailable |
| `contract_data_hard_limit` | Instance-only contract data size and corresponding hard limit | Unavailable |
| `tx_size_bytes` | Signed transaction size | Unavailable |
| `events_count` | Successful non-diagnostic contract/system events | Measured |
| `event_data_bytes` | Encoded successful event bytes plus top-level return-value bytes | Measured |

Eight metrics are measured on the supported path. Three are unavailable and must not be interpreted as zero.

A measured metric can have no independent protocol cap. For example, `events_count` is measured, but the current protocol-28 mapping has no independent event-count limit.

## 3. CPU instructions

**Metric key:** `cpu_instructions`

CPU instructions are obtained from the official native Soroban simulation's `simulated_instructions` value.

They represent metered Soroban cost-model instructions. They are not the number of instructions executed by the physical CPU in the GitHub runner or developer's computer.

The captured network compute configuration supplies the corresponding transaction limit:

- `ConfigSettingContractComputeV0.txMaxInstructions`

CPU consumption contributes to the Soroban resource fee. A rise in CPU instructions can therefore increase the resource fee when the declared transaction resources and network fee rate are considered.

Use CPU thresholds to identify computational regressions in operations such as swaps, liquidations, authorization checks and complex storage calculations.

## 4. Memory bytes

**Metric key:** `memory_bytes`

Memory is obtained from the native Soroban simulation's `simulated_memory` value.

This is metered Soroban simulation memory, not operating-system process RSS, container memory usage or the memory consumed by the WeighIn process itself.

The corresponding captured transaction memory limit is:

- `ConfigSettingContractComputeV0.txMemoryLimit`

Memory is an important execution boundary. It is not itself a separately charged fee component in the documented Soroban resource fee model.

A contract can stay below its CPU budget and still fail because it exceeds a memory limit. For that reason, memory should be monitored even though it is not a direct fee component.

## 5. Ledger read entries

**Metric key:** `ledger_read_entries`

This metric counts the distinct keys in the transaction footprint:

```text
read-only footprint entries
+
read-write footprint entries
```

It is a count of distinct footprint keys, not:

- The number of source-code read calls.
- The number of times a key is accessed.
- The number of disk entries read.
- The number of database queries performed by the application.

A key can be accessed multiple times without appearing multiple times in the footprint.

The captured network setting is:

- `ConfigSettingContractLedgerCostExtV0.txMaxFootprintEntries`

Ledger entry access contributes to resource fee calculation. Read-write entries also participate in the write-entry accounting described below.

## 6. Ledger read bytes

**Metric key:** `ledger_read_bytes`

This metric maps to `SorobanResources.diskReadBytes` under the audited supported measurement path.

For the current mapping, it represents encoded classic-ledger entry data read from disk. Live Soroban in-memory reads are not equivalent to classic-ledger disk reads and do not add the same disk-read byte consumption.

The captured network setting is:

- `ConfigSettingContractLedgerCostV0.txMaxDiskReadBytes`

Disk-read bytes contribute to resource fee calculation.

Do not interpret this metric as the total number of bytes read by the contract from every possible in-memory or storage operation.

## 7. Ledger write entries

**Metric key:** `ledger_write_entries`

This metric counts the number of keys in the read-write footprint:

```text
read-write footprint entries
```

It is not a count of only entries whose final serialized value differs from their previous value.

Under the audited mapping, no-op writes and deletion operations can still contribute to the write footprint entry count.

The captured network setting is:

- `ConfigSettingContractLedgerCostV0.txMaxWriteLedgerEntries`

Write-entry access contributes to resource fee calculation.

For DeFi operations, unexpected additional write entries can be important because a swap, deposit or liquidation may touch more persistent state than intended.

## 8. Ledger write bytes

**Metric key:** `ledger_write_bytes`

This metric maps to `SorobanResources.writeBytes` under the audited measurement path.

It represents the sum of encoded read-write postimages. No-op postimages can count; deletions do not add a postimage.

The captured network setting is:

- `ConfigSettingContractLedgerCostV0.txMaxWriteBytes`

Ledger write bytes contribute to resource fee calculation. The effective write fee can depend on storage-related network pricing, so a byte count alone is not a final fee quote.

TTL and rent-related accounting are separate concerns and should not be inferred from this metric.

## 9. Event count

**Metric key:** `events_count`

This metric counts successful, non-diagnostic contract and system events.

It excludes diagnostic and failed-call events under the audited mapping.

Protocol 28 does not provide an independent event-count cap in the current WeighIn metric mapping. The metric is still useful for detecting changes in the number of emitted events.

For example, a multi-hop swap may emit events for several pools. A code change that emits an additional event per hop can increase this count.

A project may configure an application-level policy limit, but that policy must not be described as a protocol-provided event-count cap.

## 10. Event data and return-value bytes

**Metric key:** `event_data_bytes`

This metric is the sum of:

```text
successful non-diagnostic ContractEvent XDR bytes
+
top-level return ScVal XDR bytes
```

The measurement includes XDR encoding overhead and padding. It is not simply the sum of the application payload string lengths.

The captured network setting is:

- `ConfigSettingContractEventsV0.txMaxContractEventsSizeBytes`

Event and return-value size contributes to Soroban resource fee calculation.

A function can increase this metric by emitting larger event payloads, emitting more events, or returning a larger encoded value.

## 11. Historical data read bytes

**Metric key:** `historical_data_read_bytes`

**Availability:** Unavailable.

The current protocol-28 mapping does not expose a historical-data read consumption resource corresponding to this metric.

Historical-data fees are not the same thing as historical read consumption. WeighIn therefore does not substitute a historical fee or another byte count under this metric name.

The measurement is represented as unavailable with a reason, not as zero.

## 12. Contract data hard limit

**Metric key:** `contract_data_hard_limit`

**Availability:** Unavailable.

The current implementation does not have a verified mapping for an instance-only post-invocation data size and corresponding hard limit.

Whole ledger entry sizes or other storage metrics must not be substituted and presented as this metric.

The value is represented as unavailable with a reason.

## 13. Transaction size bytes

**Metric key:** `tx_size_bytes`

**Availability:** Unavailable.

Simulation can estimate a maximum transaction envelope size, but WeighIn does not submit a signed benchmark transaction whose actual signed envelope size can be measured for this metric.

The current implementation therefore does not report the estimate as actual transaction size.

Transaction size is a resource-fee dimension in the Soroban fee model, but this WeighIn metric remains unavailable until a verified signed-transaction measurement path exists.

## 14. How metrics relate to fees

The following table summarizes the relationship between the WeighIn metrics and the fee model.

| Resource dimension | WeighIn metric | Fee relevance |
|---|---|---|
| CPU instructions | `cpu_instructions` | Contributes to resource fee calculation |
| Soroban memory | `memory_bytes` | Execution limit; not a separately charged fee component |
| Ledger entry accesses | `ledger_read_entries`, `ledger_write_entries` | Read/write entry access contributes to resource fee calculation |
| Ledger I/O | `ledger_read_bytes`, `ledger_write_bytes` | Read/write bytes contribute to resource fee calculation |
| Transaction envelope size | `tx_size_bytes` | Fee dimension, but currently unavailable in WeighIn |
| Events and return value | `events_count`, `event_data_bytes` | Encoded event and return-value size contributes to resource fee calculation |
| Historical data | `historical_data_read_bytes` | No corresponding consumption metric in the current mapping |
| Instance-only contract data | `contract_data_hard_limit` | No verified mapping in the current implementation |

The resource fee is calculated using declared resources and network fee settings. The actual transaction fee also includes the inclusion fee.

Some resource fee components are refundable or reconciled at execution, while others are non-refundable. The details depend on the protocol's fee model and network configuration.

WeighIn does not convert its benchmark report into an XLM fee estimate. Do not multiply a metric delta by a guessed price and present it as the transaction's final fee.

## 15. How to use the metrics when reviewing a PR

For every meaningful resource change:

1. Confirm that BASE and HEAD represent the same logical benchmark.
2. Confirm that the measurement provenance is compatible.
3. Review CPU and memory changes.
4. Review read/write footprint entries and bytes.
5. Review event count and encoded event/return-value bytes.
6. Check whether any metric is unavailable.
7. Compare absolute consumption with the captured network limits.
8. Apply project-specific thresholds only after reviewing the workload.

A resource regression does not automatically mean a transaction will fail. Likewise, a passing benchmark does not guarantee success under every ledger state or network condition.

## References

- [Stellar: Fees, Resource Limits, and Metering](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering)
- [Stellar Protocol CAP-0046](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0046-07.md)
- [Soroban environment fee implementation](https://github.com/stellar/rs-soroban-env/blob/main/soroban-env-host/src/fees.rs)
- [WeighIn metric provenance](metric-provenance.md)
- [WeighIn record schema](record-schema.md)
- [WeighIn known limitations](KNOWN_LIMITATIONS.md)
