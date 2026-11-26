import { contractLabel, type DiffResult } from "./diff";

export type DiffSummaryStatus =
  | "Regression"
  | "Improvement"
  | "Unchanged"
  | "Unavailable";

export interface DiffSummaryRow {
  Metric: string;
  Base: number | string;
  Head: number | string;
  Delta: number | string;
  Status: DiffSummaryStatus;
}

function displayValue(value: number | null): number | string {
  return value === null ? "N/A" : value;
}

function statusFor(
  delta: number | null,
  available: boolean,
): DiffSummaryStatus {
  if (!available || delta === null) return "Unavailable";
  if (delta > 0) return "Regression";
  if (delta < 0) return "Improvement";
  return "Unchanged";
}

export function buildDiffSummaryRows(diff: DiffResult): DiffSummaryRow[] {
  const rows: DiffSummaryRow[] = [];

  for (const contract of diff.contracts) {
    for (const fn of contract.functions) {
      const functionLabel = fn.case_id
        ? `${fn.function_name} (${fn.case_id})`
        : fn.function_name;

      for (const metric of fn.metrics) {
        rows.push({
          Metric: [contractLabel(contract), functionLabel, metric.key].join(
            " / ",
          ),
          Base: displayValue(metric.base.consumed),
          Head: displayValue(metric.head.consumed),
          Delta: displayValue(metric.delta),
          Status: statusFor(metric.delta, metric.availability === "comparable"),
        });
      }
    }
  }

  for (const aggregate of diff.aggregates ?? []) {
    for (const metric of aggregate.metrics) {
      rows.push({
        Metric: `Aggregate: ${aggregate.name} / ${metric.key}`,
        Base: displayValue(metric.base_consumed),
        Head: displayValue(metric.head_consumed),
        Delta: displayValue(metric.delta),
        Status: statusFor(metric.delta, metric.availability === "comparable"),
      });
    }
  }

  return rows;
}
