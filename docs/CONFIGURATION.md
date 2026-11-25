
# WeighIn Configuration Reference

This document describes the supported configuration options in
`weighin.toml`.

The configuration controls how WeighIn evaluates Soroban resource usage
regressions between BASE and HEAD benchmark measurements.

The authoritative configuration schema is defined in:

- `src/config.ts`
- `src/threshold.ts`
- `src/diff.ts`
- `src/record-schema.ts`

Configuration is parsed as TOML and validated before policy evaluation.
Unknown keys, unsupported rules, negative values, and invalid configuration
structures are rejected.

## Configuration File

The default configuration filename is:

```text
weighin.toml
```

The GitHub Action uses the `config-path` input to select the policy file.

If the configured file is absent, no regression thresholds are enforced.
A missing policy must not be confused with a failed policy evaluation.

## Configuration Structure

WeighIn supports three main configuration sections:

```toml
[thresholds.global]

[thresholds.functions.hello]

[limits.global]

[limits.functions.hello]

[aggregates.example]

[limits.aggregates.example]

[thresholds.aggregates.example]
```

The sections serve different purposes:

| Section | Purpose |
|---|---|
| `[thresholds.global]` | Global regression behavior and CPU/memory percentage limits |
| `[thresholds.functions.<name>]` | Relative regression rules for a contract function |
| `[limits.global]` | Absolute maximum resource consumption across matched benchmarks |
| `[limits.functions.<name>]` | Absolute maximum resource consumption for a specific function |
| `[aggregates.<name>]` | Definition of an aggregate benchmark budget |
| `[limits.aggregates.<name>]` | Absolute limits for an aggregate |
| `[thresholds.aggregates.<name>]` | Relative thresholds for an aggregate |

## Supported Metrics

The authoritative metric list is declared by `METRIC_KEYS` in
`src/record-schema.ts`.

| Metric | Description | Current availability |
|---|---|---|
| `cpu_instructions` | Consumed Soroban CPU instructions | Measured |
| `memory_bytes` | Cumulative invocation memory consumption | Measured |
| `ledger_read_entries` | Read-only plus read-write footprint entries | Measured |
| `ledger_read_bytes` | Disk read bytes | Measured |
| `ledger_write_entries` | Read-write footprint entries | Measured |
| `ledger_write_bytes` | Ledger write bytes | Measured |
| `historical_data_read_bytes` | Historical data read consumption | Unavailable |
| `contract_data_hard_limit` | Instance-only contract data size | Unavailable |
| `tx_size_bytes` | Signed benchmark transaction size | Unavailable |
| `events_count` | Successful contract/system event count | Measured |
| `event_data_bytes` | Successful event and return XDR bytes | Measured |

Unavailable metrics are represented with null consumption and an explanatory
reason. A configured policy requiring an unavailable metric fails closed
rather than treating the metric as zero.

Metric definitions and source mappings are documented in
[Metric Provenance](metric-provenance.md).

## Relative Thresholds

Relative thresholds evaluate the difference between BASE and HEAD.

They are configured under `[thresholds.functions.<function_name>]`,
`[thresholds.global]`, or the applicable aggregate threshold section.

### Supported Rule Values

Three kinds of rule values are supported.

| Rule | Meaning |
|---|---|
| `"strict_zero_tolerance"` | Any increase in the metric is a violation |
| `"allow_5_percent_increase"` | Allows an increase up to 5% |
| `"ignore"` | Excludes the metric from regression enforcement |
| `5` | Numeric equivalent of allowing a 5% increase |

Percentage values must be finite and nonnegative.

Percentage equality passes. Only an increase strictly greater than the
configured allowance fails.

### Strict Zero Tolerance

Example:

```toml
[thresholds.functions.hello]
cpu_instructions = "strict_zero_tolerance"
ledger_write_entries = "strict_zero_tolerance"
ledger_write_bytes = "strict_zero_tolerance"
```

With this configuration, any increase in the listed metrics causes a
threshold violation for matched `hello` benchmarks.

### Percentage Regression Allowance

Example:

```toml
[thresholds.functions.hello]
cpu_instructions = "allow_5_percent_increase"
memory_bytes = "allow_10_percent_increase"
ledger_write_bytes = 5
```

This configuration allows:

- Up to 5% additional CPU instructions.
- Up to 10% additional memory consumption.
- Up to 5% additional ledger write bytes.

An increase greater than the corresponding allowance fails evaluation.

### Ignore a Metric

Example:

```toml
[thresholds.functions.hello]
cpu_instructions = "strict_zero_tolerance"
memory_bytes = "ignore"
```

CPU regressions are enforced while memory regressions are ignored.

An explicit ignore rule is useful when a metric is intentionally excluded
from policy enforcement.

## Global Thresholds

Global regression behavior is configured under:

```toml
[thresholds.global]
```

The currently supported keys are:

| Key | Type | Description |
|---|---|---|
| `fail_on_any_regression` | Boolean | Fail when any comparable metric increases |
| `max_allowed_cpu_increase_pct` | Number | Maximum allowed CPU increase percentage |
| `max_allowed_memory_increase_pct` | Number | Maximum allowed memory increase percentage |

Example:

```toml
[thresholds.global]
fail_on_any_regression = true
max_allowed_cpu_increase_pct = 5
max_allowed_memory_increase_pct = 10
```

`fail_on_any_regression` enables strict regression behavior across comparable
metrics.

The global CPU and memory percentage settings provide specific percentage
allowances for those metrics.

Function-specific rules take precedence over the global regression rule
for the same metric.

For unavailable metrics, a policy requiring evaluation cannot silently pass.
Explicit function-level `ignore` rules can be used where appropriate.

## Function-Specific Thresholds

Function-specific rules are configured using the actual Soroban function name.

Example:

```toml
[thresholds.functions.hello]
cpu_instructions = "strict_zero_tolerance"
memory_bytes = "allow_5_percent_increase"

[thresholds.functions.transfer]
ledger_write_entries = "strict_zero_tolerance"
ledger_write_bytes = "allow_10_percent_increase"
```

The rules apply to every matching benchmark case for the named function.

A configured non-ignored function rule must match at least one BASE/HEAD
benchmark. An unmatched function rule causes policy evaluation to fail
rather than silently passing.

## Absolute Resource Limits

Absolute limits define the maximum permitted HEAD consumption.

They are configured under `[limits.global]` or
`[limits.functions.<function_name>]`.

Unlike relative thresholds, absolute limits do not compare the percentage
change from BASE.

Example:

```toml
[limits.global]
cpu_instructions = 500000
memory_bytes = 1000000
```

This sets the maximum HEAD CPU consumption to 500,000 instructions and
maximum HEAD memory consumption to 1,000,000 bytes for matched benchmarks.

### Function-Specific Absolute Limits

```toml
[limits.functions.hello]
cpu_instructions = 350000
memory_bytes = 800000
ledger_write_entries = 10
ledger_write_bytes = 500
```

The limits apply only to the matching function.

### Absolute Limit Evaluation

The evaluation follows these rules:

- HEAD consumption equal to the configured limit passes.
- HEAD consumption greater than the limit fails.
- An unavailable metric cannot satisfy a configured absolute limit.
- A configured function limit must match an evaluated benchmark.
- A configured global limit requires matched benchmarks.
- New or removed cases alone do not establish an absolute BASE/HEAD comparison.

A function-specific absolute limit takes precedence over a global absolute
limit for the same metric.

## Aggregate Resource Budgets

WeighIn supports aggregate budgets that group multiple benchmark functions
into one resource budget.

An aggregate definition is placed under `[aggregates.<name>]`.

Each aggregate requires a nonempty `members` array. Every member must include
a `function_name` and may optionally include `fixture_id`, `logical_id`,
and `case_id` selectors.

Example:

```toml
[aggregates.payment_flow]
description = "Combined resource budget for payment operations"

members = [
  { function_name = "transfer" },
  { function_name = "approve" }
]

[limits.aggregates.payment_flow]
cpu_instructions = 900000
ledger_write_bytes = 2000

[thresholds.aggregates.payment_flow]
memory_bytes = "allow_5_percent_increase"
```

Aggregate limits and thresholds can also be specified directly inside the
aggregate definition:

```toml
[aggregates.payment_flow]
description = "Payment operations budget"

members = [
  { function_name = "transfer" },
  { function_name = "approve" }
]

[aggregates.payment_flow.limits]
cpu_instructions = 900000

[aggregates.payment_flow.thresholds]
memory_bytes = "allow_5_percent_increase"
```

When both aggregate-local and corresponding `[limits.aggregates]` or
`[thresholds.aggregates]` entries are supplied, the separate named section
overrides the same metric from the aggregate definition.

Aggregate budgets are evaluated against the matched aggregate members.

## Strict Configuration Example

The following configuration applies strict regression checks to important
operations and enforces absolute resource ceilings.

```toml
[thresholds.global]
fail_on_any_regression = true

[thresholds.functions.hello]
cpu_instructions = "strict_zero_tolerance"
ledger_write_entries = "strict_zero_tolerance"
ledger_write_bytes = "strict_zero_tolerance"

[thresholds.functions.transfer]
cpu_instructions = "strict_zero_tolerance"
memory_bytes = "allow_5_percent_increase"

[limits.global]
cpu_instructions = 1000000
memory_bytes = 2000000
```

Use this configuration when resource increases must be carefully controlled.

Remember that strict global regression enforcement must account for unavailable
metrics. Explicit ignores are available for function-specific exceptions.

## Permissive Configuration Example

The following configuration allows moderate increases while keeping an
absolute ceiling on important resources.

```toml
[thresholds.global]
fail_on_any_regression = false
max_allowed_cpu_increase_pct = 10
max_allowed_memory_increase_pct = 15

[thresholds.functions.hello]
cpu_instructions = "allow_10_percent_increase"
memory_bytes = "allow_15_percent_increase"
ledger_write_bytes = "ignore"

[limits.global]
cpu_instructions = 1000000
memory_bytes = 2000000
```

This is a more flexible starting point while establishing baseline
measurements.

## Empty and Missing Configuration

The following cases have different meanings:

| Configuration state | Behavior |
|---|---|
| No `weighin.toml` file | No regression thresholds enforced |
| Explicitly empty configuration | No regression thresholds enforced |
| Valid configuration with rules | Rules are evaluated |
| Invalid TOML | Configuration parsing fails |
| Unsupported key or rule | Schema validation fails |
| Policy references an unmatched function | Evaluation fails |

A missing policy is not a substitute for a strict security policy. Repositories
should introduce meaningful thresholds after establishing reliable baseline
measurements.

## Validation and Troubleshooting

Configuration validation is performed using `WeighinConfigSchema` in
`src/config.ts`.

Common problems include:

### Unsupported metric

Only keys declared in `METRIC_KEYS` are accepted.

### Invalid percentage

Percentage values must be finite and nonnegative.

### Unsupported rule string

Use one of:

- `strict_zero_tolerance`
- `allow_N_percent_increase`
- `ignore`

### Invalid TOML structure

Check table names, quotation marks, arrays, and numeric values.

### Unavailable metric

Do not configure an unavailable metric as though it were measured zero.
Use a supported metric or explicitly ignore the unavailable metric where
appropriate.

### Unmatched function

Ensure that the configured function name exists in at least one matched
BASE/HEAD benchmark.

## Related Documentation

- [Architecture](ARCHITECTURE.md)
- [CLI Usage](CLI.md)
- [Integration Guide](INTEGRATION-GUIDE.md)
- [Metric Provenance](metric-provenance.md)
- [Comparison Identity](comparison-identity.md)
- [Record Schema](record-schema.md)
