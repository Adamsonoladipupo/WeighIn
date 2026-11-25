# Exporting benchmark history

Benchmark JSON artifacts can be retained as evidence and converted into CSV or dashboard
data for long-term resource-efficiency trends.

## Save raw artifacts

Capture one immutable artifact per benchmark run in a dated directory:

```text
benchmarks/
  2026-01/
    diff.json
  2026-02/
    diff.json
```

When using GitHub Actions, upload the raw diff output as a workflow artifact:

```yaml
- name: Save benchmark diff
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: weighin-diff-${{ github.sha }}
    path: diff.json
    retention-days: 365
```

Do not rewrite old JSON artifacts. Preserve the commit SHA, timestamp, workflow run,
schema version, and source provenance needed to identify each run.

## Parse JSON into CSV

The diff shape contains contracts, functions, and metric entries. A small Node.js script
can flatten it:

```javascript
import fs from "node:fs";

const diff = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const rows = ["date,contract,function,case,metric,base,head,delta,regression"];

for (const contract of diff.contracts ?? []) {
  const contractName =
    contract.fixture_id ?? contract.logical_id ?? contract.contract_id ?? "";

  for (const fn of contract.functions ?? []) {
    for (const metric of fn.metrics ?? []) {
      const base = metric.base?.consumed ?? "";
      const head = metric.head?.consumed ?? "";
      const delta = metric.delta ?? "";
      rows.push([
        process.env.RUN_DATE ?? "",
        contractName,
        fn.function_name,
        fn.case_id ?? "",
        metric.key,
        base,
        head,
        delta,
        metric.availability === "unavailable" ? "" : metric.regression,
      ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
    }
  }
}

process.stdout.write(`${rows.join("\n")}\n`);
```

Run it with:

```bash
RUN_DATE=2026-01-31 node flatten-diff.mjs diff.json > metrics.csv
```

## Dashboard loading

Load CSV rows into a spreadsheet or BI tool using the columns:

- `date`
- `contract`
- `function`
- `case`
- `metric`
- `base`
- `head`
- `delta`
- `regression`

For trend dashboards, partition by metric and contract or fixture identity, then plot
`head` and `delta` over time. Filter unavailable metrics instead of converting missing
values to zero.

JSON archives are best for replay and provenance; CSV is convenient for charting.
Preserve both forms when historical comparisons must be auditable.
