import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";

export function writeReportFile(
  reportPathInput: string,
  headWorkspace: string,
  body: string,
): void {
  if (!reportPathInput) return;
  const targetPath = path.resolve(headWorkspace, reportPathInput);
  try {
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(targetPath, body, "utf8");
    core.info(`Wrote Markdown report to ${targetPath}`);
  } catch (err: any) {
    throw new Error(
      `Failed to write WeighIn report to ${targetPath}: ${err.message}`,
    );
  }
}

export function generateFailureReport(errorMessage: string): string {
  return [
    "# WeighIn Resource Benchmark: Unsuccessful Comparison",
    "",
    "> **Status: FAILED** — A comparison or policy result could not be established due to an execution failure.",
    "",
    "## Failure Details",
    "",
    "```",
    errorMessage,
    "```",
    "",
    "## Policy Result",
    "",
    "- **Policies established:** No",
    "- **Thresholds evaluated:** None",
    "- **Benchmark metrics:** None (not measured)",
    "",
    "No passing comparison, deltas, or resource consumption metrics were established.",
    "",
  ].join("\n");
}


/**
 * Report evaluation and policy status structures.
 */

export type PolicyState = 'report-only' | 'passed' | 'violated' | 'absent' | 'empty';

export interface ReportEvaluationResult {
  state: PolicyState;
  violationsCount: number;
  reportOnly: boolean;
  hasPolicy: boolean;
  message: string;
}

export function evaluateReportPolicy(policy: any, metrics: any[], reportOnlyMode: boolean = false): ReportEvaluationResult {
  const hasPolicy = Boolean(policy && (policy.thresholds || policy.rules));
  
  if (!hasPolicy) {
    return {
      state: 'absent',
      violationsCount: 0,
      reportOnly: reportOnlyMode,
      hasPolicy: false,
      message: 'No policy configured (report-only evaluation)'
    };
  }

  if (metrics.length === 0) {
    return {
      state: 'empty',
      violationsCount: 0,
      reportOnly: reportOnlyMode,
      hasPolicy: true,
      message: 'Loaded-empty policy report'
    };
  }

  // Evaluate thresholds/rules violations
  const violations = metrics.filter(m => m.violated === true);
  const violationsCount = violations.length;

  if (violationsCount > 0) {
    return {
      state: 'violated',
      violationsCount,
      reportOnly: reportOnlyMode,
      hasPolicy: true,
      message: `Policy violated: ${violationsCount} threshold(s) breached`
    };
  }

  if (reportOnlyMode) {
    return {
      state: 'report-only',
      violationsCount: 0,
      reportOnly: true,
      hasPolicy: true,
      message: 'Report-only execution: all thresholds passed'
    };
  }

  return {
    state: 'passed',
    violationsCount: 0,
    reportOnly: false,
    hasPolicy: true,
    message: 'All thresholds passed'
  };
}
