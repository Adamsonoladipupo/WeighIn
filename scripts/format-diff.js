#!/usr/bin/env node

"use strict";

const fs = require("node:fs");

const ANSI = {
  red: "\u001b[31m",
  green: "\u001b[32m",
  gray: "\u001b[90m",
  reset: "\u001b[0m",
};

function consumed(metric, side) {
  const value = metric && metric[side] ? metric[side].consumed : null;
  return typeof value === "number" ? value : null;
}

function formatNumber(value) {
  return value === null ? "-" : String(value);
}

function formatPercent(metric) {
  if (metric.pct === null) return "-";
  return `${metric.pct >= 0 ? "+" : ""}${metric.pct.toFixed(2)}%`;
}

function formatMetricRows(diff) {
  const rows = [];

  for (const contract of diff.contracts ?? []) {
    const contractName =
      contract.fixture_id ?? contract.logical_id ?? contract.contract_id ?? "unknown";

    for (const func of contract.functions ?? []) {
      for (const metric of func.metrics ?? []) {
        const base = consumed(metric, "base");
        const head = consumed(metric, "head");
        const unavailable = metric.availability === "unavailable";
        const delta = unavailable || metric.delta === null ? null : metric.delta;
        rows.push({
          context: `${contractName} / ${func.function_name}${func.case_id ? ` / ${func.case_id}` : ""}`,
          metric: metric.key,
          base,
          head,
          delta,
          change: unavailable ? "-" : formatPercent(metric),
          unavailable,
          regression: !unavailable && metric.regression === true,
        });
      }
    }
  }

  for (const aggregate of diff.aggregates ?? []) {
    for (const metric of aggregate.metrics ?? []) {
      const base = typeof metric.base_consumed === "number" ? metric.base_consumed : null;
      const head = typeof metric.head_consumed === "number" ? metric.head_consumed : null;
      const unavailable = metric.availability === "unavailable";
      rows.push({
        context: `aggregate / ${aggregate.name}`,
        metric: metric.key,
        base,
        head,
        delta: unavailable || metric.delta === null ? null : metric.delta,
        change: unavailable ? "-" : metric.pct === null ? "-" : `${metric.pct >= 0 ? "+" : ""}${metric.pct.toFixed(2)}%`,
        unavailable,
        regression: !unavailable && metric.regression === true,
      });
    }
  }

  return rows;
}

function formatSigned(value) {
  if (value === null) return "-";
  return value >= 0 ? `+${value}` : String(value);
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function formatDiff(diff, useColor = process.stdout.isTTY) {
  if (!diff || typeof diff !== "object" || !Array.isArray(diff.contracts)) {
    throw new Error("Invalid diff JSON: expected an object with a contracts array");
  }

  const rows = formatMetricRows(diff);
  const headers = ["CONTEXT", "METRIC", "BASE", "HEAD", "DELTA", "CHANGE"];
  const widths = headers.map((header, index) =>
    Math.max(
      header.length,
      ...rows.map((row) => {
        const values = [
          row.context,
          row.metric,
          formatNumber(row.base),
          formatNumber(row.head),
          formatSigned(row.delta),
          row.change,
        ];
        return values[index].length;
      }),
    ),
  );

  const lines = [
    headers.map((header, index) => pad(header, widths[index])).join("  "),
  ];
  lines.push(widths.map((width) => "-".repeat(width)).join("  "));

  for (const row of rows) {
    const values = [
      row.context,
      row.metric,
      formatNumber(row.base),
      formatNumber(row.head),
      formatSigned(row.delta),
      row.change,
    ];
    let line = values.map((value, index) => pad(value, widths[index])).join("  ");

    if (useColor) {
      const color = row.unavailable
        ? ANSI.gray
        : row.regression
          ? ANSI.red
          : row.delta !== null && row.delta < 0
            ? ANSI.green
            : ANSI.gray;
      line = `${color}${line}${ANSI.reset}`;
    }
    lines.push(line);
  }

  if (rows.length === 0) lines.push("No metric comparisons found.");
  return lines.join("\n");
}

function main(argv) {
  if (argv.length !== 1) {
    throw new Error("Usage: node scripts/format-diff.js <raw-diff.json>");
  }

  const file = argv[0];
  const diff = JSON.parse(fs.readFileSync(file, "utf8"));
  process.stdout.write(`${formatDiff(diff)}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { formatDiff, formatMetricRows };
