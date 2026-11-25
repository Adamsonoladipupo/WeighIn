# Soroban and WeighIn glossary

This glossary defines common terms used by WeighIn's measurements and documentation.

## Base

The baseline measurement or source revision used for comparison. It represents the
before state of a benchmark.

## Head

The candidate measurement or source revision used for comparison. It represents the
after state of a benchmark.

## Base/Head Diff

A comparison that subtracts base metric consumption from head metric consumption,
reports percentage change where meaningful, and identifies increases as regressions.

## CPU Instructions

Metered Soroban cost-model instructions reported by simulation. This is not the number
of instructions executed by a physical host CPU.

## Ledger Footprint

The set of ledger entries a Soroban transaction declares for read-only and read-write
access. Its entries are resource-budgeted even when individual keys are accessed repeatedly.

## Ledger Read Bytes

The mapped disk-read byte resource reported for simulation. It is a Soroban resource
measurement, not the physical bytes read by the GitHub runner.

## Ledger Write Bytes

Encoded read-write postimages produced by a transaction. Deletions do not contribute a
postimage, while no-op writes can still count under the supported measurement mapping.

## Rent

Soroban account and contract state rent paid to keep ledger entries alive. TTL and rent
details are separate from direct ledger write-byte measurements.

## ScVal

Stellar Contract Value (ScVal): the typed Soroban value representation for arguments,
return values, contract storage, and events.

## Simulation

A local or RPC Soroban execution that predicts resource consumption and validates an
operation before it is submitted as a transaction.

## Envelope

The signed transaction container. It includes transaction metadata and can affect
transaction-size accounting.

## Fixture

A repeatable benchmark input definition containing contract setup and function calls.
Fixtures keep measurements comparable across runs.

## Metric

A named resource measurement such as CPU instructions, memory bytes, ledger footprint
entries, or event bytes.

## Delta

The absolute head-minus-base change for a metric. Positive values mean head consumed
more; negative values mean head consumed less.

## Regression

A head result with greater consumption than base for a thresholded metric. Regressions
can be compared against configured limits without interpreting every increase as a final
fee failure.

## Unavailable Metric

A metric whose consumed value cannot be obtained or compared. WeighIn preserves this
state instead of interpreting missing data as zero.

## Aggregate

A named sum of measurements across selected benchmark members. Aggregate metrics retain
member provenance and report cumulative values rather than peak concurrent usage.

## Provenance

Metadata describing the source, schema, protocol, network, and build configuration used
to produce a measurement. It supports source and identity comparisons.

## Resource Fee

The Soroban resource cost charged in addition to the inclusion fee. It depends on
declared resources and network fee configuration.
