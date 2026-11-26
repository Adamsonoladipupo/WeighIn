import { describe, expect, it } from "vitest";
import {
  METRIC_KEYS,
  type AggregateDiff,
  type AggregateMemberBreakdown,
  type ContractDiff,
  type DiffResult,
  type MetricDiff,
  type MetricKey,
} from "../src/diff";
import { buildDiffSummaryRows } from "../src/diff-summary";

function createMetricDiff(
  key: MetricKey,
  baseConsumed: number | null,
  headConsumed: number | null,
  delta: number | null,
  availability: MetricDiff["availability"],
): MetricDiff {
  return {
    key,
    base: { consumed: baseConsumed, limit: null },
    head: { consumed: headConsumed, limit: null },
    delta,
    availability,
    pct: null,
    regression: delta !== null && delta > 0,
  };
}

function createDiff(): DiffResult {
  const contract: ContractDiff = {
    fixture_id: "weighin-fixtures.json",
    logical_id: "reference-contract",
    contract_id: "head-contract",
    base_contract_id: "base-contract",
    head_contract_id: "head-contract",
    base_commit: "base-sha",
    head_commit: "head-sha",
    functions: [
      {
        function_name: "transfer",
        case_id: "happy-path",
        metrics: [
          createMetricDiff("cpu_instructions", 100, 125, 25, "comparable"),
          createMetricDiff("memory_bytes", 100, 90, -10, "comparable"),
          createMetricDiff("ledger_read_entries", 100, 100, 0, "comparable"),
          createMetricDiff("tx_size_bytes", null, null, null, "unavailable"),
        ],
        hasRegression: true,
      },
    ],
    hasRegression: true,
    newFunctions: [],
    removedFunctions: [],
    newBenchmarks: [],
    removedBenchmarks: [],
  };

  const breakdown = Object.fromEntries(
    METRIC_KEYS.map((key) => [key, []]),
  ) as Record<MetricKey, AggregateMemberBreakdown[]>;

  const aggregate: AggregateDiff = {
    name: "All contracts",
    members: [],
    member_count: 0,
    breakdown,
    metrics: [
      {
        key: "cpu_instructions",
        base_consumed: 100,
        head_consumed: 125,
        delta: 25,
        pct: 25,
        regression: true,
        availability: "comparable",
        description: "CPU instructions",
      },
      {
        key: "tx_size_bytes",
        base_consumed: null,
        head_consumed: null,
        delta: null,
        pct: null,
        regression: false,
        availability: "unavailable",
        reason: "No signed transaction was submitted",
        description: "Transaction size",
      },
    ],
    hasRegression: true,
  };

  return {
    contracts: [contract],
    aggregates: [aggregate],
    hasRegression: true,
    newContracts: [],
    removedContracts: [],
  };
}

describe("buildDiffSummaryRows", () => {
  it("formats contract metrics and distinguishes all comparison statuses", () => {
    const rows = buildDiffSummaryRows(createDiff());
    const prefix =
      "weighin-fixtures.json / reference-contract / transfer (happy-path)";

    expect(rows.slice(0, 4)).toEqual([
      {
        Metric: `${prefix} / cpu_instructions`,
        Base: 100,
        Head: 125,
        Delta: 25,
        Status: "Regression",
      },
      {
        Metric: `${prefix} / memory_bytes`,
        Base: 100,
        Head: 90,
        Delta: -10,
        Status: "Improvement",
      },
      {
        Metric: `${prefix} / ledger_read_entries`,
        Base: 100,
        Head: 100,
        Delta: 0,
        Status: "Unchanged",
      },
      {
        Metric: `${prefix} / tx_size_bytes`,
        Base: "N/A",
        Head: "N/A",
        Delta: "N/A",
        Status: "Unavailable",
      },
    ]);
  });

  it("includes aggregate rows and marks aggregate unavailable values as N/A", () => {
    const rows = buildDiffSummaryRows(createDiff());

    expect(rows.slice(4)).toEqual([
      {
        Metric: "Aggregate: All contracts / cpu_instructions",
        Base: 100,
        Head: 125,
        Delta: 25,
        Status: "Regression",
      },
      {
        Metric: "Aggregate: All contracts / tx_size_bytes",
        Base: "N/A",
        Head: "N/A",
        Delta: "N/A",
        Status: "Unavailable",
      },
    ]);
  });

  it("returns no rows when the diff has no matched metrics", () => {
    const rows = buildDiffSummaryRows({
      contracts: [],
      aggregates: [],
      hasRegression: false,
      newContracts: [],
      removedContracts: [],
    });

    expect(rows).toEqual([]);
  });
});
