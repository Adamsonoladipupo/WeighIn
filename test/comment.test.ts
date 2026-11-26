import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  renderComment,
  findReportComment,
  upsertPrComment,
  COMMENT_MARKER,
  MAX_COMMENT_LENGTH,
  TRUNCATION_NOTICE,
} from "../src/comment";
import { DiffResult } from "../src/diff";
import { Violation } from "../src/threshold";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";

function createMockDiff(regression: boolean): DiffResult {
  return {
    contracts: [
      {
        fixture_id: "path:fixtures.json",
        logical_id: "id:contract-a",
        contract_id: "contract-a",
        base_contract_id: "base-contract-a",
        head_contract_id: "contract-a",
        base_commit: "abc",
        head_commit: "def",
        hasRegression: regression,
        newFunctions: [],
        removedFunctions: [],
        newBenchmarks: [],
        removedBenchmarks: [],
        functions: [
          {
            function_name: "test-fn",
            hasRegression: regression,
            metrics: [
              {
                key: "cpu_instructions",
                base: { consumed: 100, limit: 1000 },
                head: { consumed: regression ? 110 : 100, limit: 1000 },
                delta: regression ? 10 : 0,
                pct: regression ? 10 : 0,
                regression,
              },
            ],
          },
        ],
      },
    ],
    hasRegression: regression,
    newContracts: [],
    removedContracts: [],
  };
}

describe("renderComment", () => {
  it("renders a success status when no regressions and no violations", () => {
    const diff = createMockDiff(false);
    const comment = renderComment(diff, [], "main", "abcdef123");
    expect(comment).toContain("🟢");
    expect(comment).toContain("**All thresholds passed**");
  });

  it("renders a success status when there are regressions but no threshold violations", () => {
    const diff = createMockDiff(true);
    const comment = renderComment(diff, [], "main", "abcdef123");
    expect(comment).toContain("🟢");
    expect(comment).toContain("**All thresholds passed**");
    expect(comment).toContain(
      "🔴 | CPU Instructions | 100 | 110 | +10 | +10.0% | 1,000 |",
    );
  });

  it("renders a failure status when threshold violations exist", () => {
    const diff = createMockDiff(true);
    const violation: Violation = {
      contract_id: "contract-a",
      function_name: "test-fn",
      metric: "cpu_instructions",
      delta: 10,
      pct: 10,
      rule: "strict_zero_tolerance",
      message: "Fail msg",
    };
    const comment = renderComment(diff, [violation], "main", "abcdef123");
    expect(comment).toContain("🔴");
    expect(comment).toContain("**1 threshold violation**");
    expect(comment).toContain("### ❌ Violations");
    expect(comment).toContain("Fail msg");
  });

  it("keeps primary evidence visible and folds verbose provenance into details", () => {
    const diff = createMockDiff(true);
    const fn = diff.contracts[0].functions[0];
    fn.case_id = "args:[]";
    fn.base_provenance = {
      source: "soroban-simulation",
      source_version: "28.0.1",
      protocol: 28,
      helper_sha256: "a".repeat(64),
      network_id: "test-network",
      ledger: 229,
      header_sha256: "b".repeat(64),
      snapshot_sha256: "c".repeat(64),
      config_sha256: "d".repeat(64),
      compute_config_sha256: "e".repeat(64),
      input_sha256: "f".repeat(64),
      seed: [],
      auth_mode: "recording",
      host_features: [],
      resource_limits_sha256: "1".repeat(64),
    };
    fn.head_provenance = {
      ...fn.base_provenance,
      ledger: 230,
      helper_sha256: "2".repeat(64),
      snapshot_sha256: "3".repeat(64),
      config_sha256: "4".repeat(64),
      compute_config_sha256: "5".repeat(64),
      input_sha256: "6".repeat(64),
      resource_limits_sha256: "7".repeat(64),
    };
    fn.metrics[0].head.source = "simulated_instructions";
    fn.metrics[0].head.limit_source = "protocol_limit";
    fn.metrics.push({
      key: "memory_bytes",
      base: { consumed: null, limit: null, reason: "Unavailable in BASE" },
      head: {
        consumed: null,
        limit: null,
        reason: "Unsupported by this simulator",
        source: "native-memory-meter",
        limit_reason: "No independent cap",
      },
      availability: "unavailable",
      reason: "BASE: Unavailable in BASE; HEAD: Unsupported by this simulator",
      delta: null,
      pct: null,
      regression: false,
    });

    const report = renderComment(
      diff,
      [
        {
          contract_id: "contract-a",
          function_name: "test-fn",
          case_id: "args:[]",
          metric: "cpu_instructions",
          delta: 10,
          pct: 10,
          rule: "strict_zero_tolerance",
          message: "CPU policy breach",
        },
      ],
      "main",
      "abcdef123",
    );
    const detailsStart = report.indexOf(
      "<details><summary>Snapshot and metric provenance</summary>",
    );
    const detailsEnd = report.indexOf("</details>", detailsStart);
    const beforeDetails = report.slice(0, detailsStart);
    const details = report.slice(detailsStart, detailsEnd);

    expect(detailsStart).toBeGreaterThan(0);
    expect(detailsEnd).toBeGreaterThan(detailsStart);
    expect(beforeDetails).toContain(
      "Compute source: soroban-simulation 28.0.1; protocol 28.",
    );
    expect(beforeDetails).toContain("CPU policy breach");
    expect(beforeDetails).toContain(
      "| 🔴 | CPU Instructions | 100 | 110 | +10 | +10.0% | 1,000 |",
    );
    expect(beforeDetails).toContain("Unsupported by this simulator");
    expect(details).toContain("Snapshot ledgers: BASE 229 → HEAD 230.");
    expect(details).toContain("No independent cap");
    expect(details).toContain(
      `Helper SHA256: BASE \`${"a".repeat(64)}\` → HEAD \`${"2".repeat(64)}\`.`,
    );
    expect(details).toContain("simulated_instructions");
    expect(details).toContain("native-memory-meter");
  });

  it("renders legacy records without provenance as a normal Markdown table", () => {
    const report = renderComment(
      createMockDiff(false),
      [],
      "main",
      "abcdef123",
    );
    expect(report).toContain(
      "| | Metric | Base | Head | Delta | Change | Limit |",
    );
    expect(report).toContain("#### `test-fn`");
    expect(report).not.toContain("Snapshot and metric provenance");
    expect(report).toContain("<!-- weighin-report -->");
  });

  it("formats missing functions and contracts", () => {
    const diff = createMockDiff(false);
    diff.newContracts.push("new-contract");
    diff.removedContracts.push("old-contract");
    diff.contracts[0].newBenchmarks.push({
      function_name: "new-fn",
      case_id: "args:[]",
    });
    diff.contracts[0].removedBenchmarks.push({
      function_name: "old-fn",
      case_id: "args:[]",
    });

    const comment = renderComment(diff, [], "main", "abcdef123");
    expect(comment).toContain("new-contract");
    expect(comment).toContain("old-contract");
    expect(comment).toContain("new-fn");
    expect(comment).toContain("old-fn");
  });

  it("renders byte-identical output for equivalent reordered contracts and functions without mutating inputs", () => {
    const fn1 = {
      function_name: "alpha_fn",
      case_id: "id:case-1",
      hasRegression: false,
      metrics: [
        {
          key: "cpu_instructions" as const,
          base: { consumed: 100, limit: 1000 },
          head: { consumed: 100, limit: 1000 },
          delta: 0,
          pct: 0,
          regression: false,
        },
      ],
    };
    const fn2 = {
      function_name: "beta_fn",
      case_id: "id:case-2",
      hasRegression: false,
      metrics: [
        {
          key: "cpu_instructions" as const,
          base: { consumed: 200, limit: 1000 },
          head: { consumed: 200, limit: 1000 },
          delta: 0,
          pct: 0,
          regression: false,
        },
      ],
    };

    const contractA = {
      fixture_id: "path:fixtures-a.json",
      logical_id: "id:contract-a",
      contract_id: "CAAA",
      base_contract_id: "base-CAAA",
      head_contract_id: "CAAA",
      base_commit: "abc",
      head_commit: "def",
      hasRegression: false,
      newFunctions: [],
      removedFunctions: [],
      newBenchmarks: [
        { function_name: "new_b", case_id: "id:1" },
        { function_name: "new_a", case_id: "id:1" },
      ],
      removedBenchmarks: [
        { function_name: "rem_b", case_id: "id:1" },
        { function_name: "rem_a", case_id: "id:1" },
      ],
      functions: [fn2, fn1],
    };

    const contractB = {
      fixture_id: "path:fixtures-b.json",
      logical_id: "id:contract-b",
      contract_id: "CBBB",
      base_contract_id: "base-CBBB",
      head_contract_id: "CBBB",
      base_commit: "abc",
      head_commit: "def",
      hasRegression: false,
      newFunctions: [],
      removedFunctions: [],
      newBenchmarks: [],
      removedBenchmarks: [],
      functions: [fn1],
    };

    const diff1: DiffResult = {
      contracts: [contractB, contractA],
      hasRegression: false,
      newContracts: ["zeta_contract", "alpha_contract"],
      removedContracts: ["theta_contract", "beta_contract"],
    };

    const diff2: DiffResult = {
      contracts: [
        {
          ...contractA,
          newBenchmarks: [
            { function_name: "new_a", case_id: "id:1" },
            { function_name: "new_b", case_id: "id:1" },
          ],
          removedBenchmarks: [
            { function_name: "rem_a", case_id: "id:1" },
            { function_name: "rem_b", case_id: "id:1" },
          ],
          functions: [fn1, fn2],
        },
        contractB,
      ],
      hasRegression: false,
      newContracts: ["alpha_contract", "zeta_contract"],
      removedContracts: ["beta_contract", "theta_contract"],
    };

    const violations1: Violation[] = [
      {
        contract_id: "CAAA",
        function_name: "beta_fn",
        metric: "memory_bytes",
        delta: 5,
        pct: 5,
        rule: "strict_zero_tolerance",
        message: "viol 2",
      },
      {
        contract_id: "CAAA",
        function_name: "alpha_fn",
        metric: "cpu_instructions",
        delta: 10,
        pct: 10,
        rule: "strict_zero_tolerance",
        message: "viol 1",
      },
    ];

    const violations2: Violation[] = [violations1[1], violations1[0]];

    const comment1 = renderComment(diff1, violations1, "main", "abcdef123");
    const comment2 = renderComment(diff2, violations2, "main", "abcdef123");

    expect(comment1).toBe(comment2);

    // Verify inputs were not mutated
    expect(diff1.contracts[0].contract_id).toBe("CBBB");
    expect(violations1[0].function_name).toBe("beta_fn");
  });

  it("wraps secondary metrics in details for contracts with more than 10 functions", () => {
    const diff = createMockDiff(false);
    diff.contracts[0].functions = Array.from({ length: 12 }, (_, index) => ({
      function_name: `function-${index + 1}`,
      case_id: `id:case-${index + 1}`,
      hasRegression: false,
      metrics: [
        {
          key: "cpu_instructions" as const,
          base: { consumed: 100, limit: 1000 },
          head: { consumed: 100, limit: 1000 },
          delta: 0,
          pct: 0,
          regression: false,
        },
      ],
    }));

    const comment = renderComment(diff, [], "main", "abcdef123");

    expect(comment).toContain("<details><summary>Secondary metrics</summary>");
    expect(comment).toContain("</details>");
    expect(comment).toContain("#### `function-11 / id:case-11`");
  });

  it("truncates comment with many benchmark rows and appends truncation notice", () => {
    // Create a diff with many functions, each with many metrics to generate a large comment
    const diff = createMockDiff(false);
    diff.contracts[0].functions = Array.from({ length: 250 }, (_, index) => ({
      function_name: `benchmark-function-${index + 1}`,
      case_id: `id:case-${index + 1}`,
      hasRegression: index % 10 === 0, // Some regressions for variety
      metrics: [
        {
          key: "cpu_instructions" as const,
          base: { consumed: 100000 + index * 100, limit: 1000000 },
          head: { consumed: 110000 + index * 100, limit: 1000000 },
          delta: 10000,
          pct: 10.0,
          regression: true,
        },
        {
          key: "memory_bytes" as const,
          base: { consumed: 50000 + index * 50, limit: 500000 },
          head: { consumed: 55000 + index * 50, limit: 500000 },
          delta: 5000,
          pct: 10.0,
          regression: true,
        },
        {
          key: "ledger_write_bytes" as const,
          base: { consumed: 1000 + index * 10, limit: 10000 },
          head: { consumed: 1100 + index * 10, limit: 10000 },
          delta: 100,
          pct: 10.0,
          regression: true,
        },
        {
          key: "ledger_read_entries" as const,
          base: { consumed: 2000 + index * 5, limit: 5000 },
          head: { consumed: 2100 + index * 5, limit: 5000 },
          delta: 100,
          pct: 5.0,
          regression: true,
        },
        {
          key: "ledger_read_bytes" as const,
          base: { consumed: 30000 + index * 20, limit: 100000 },
          head: { consumed: 31000 + index * 20, limit: 100000 },
          delta: 1000,
          pct: 3.3,
          regression: true,
        },
        {
          key: "ledger_write_entries" as const,
          base: { consumed: 500 + index * 2, limit: 2000 },
          head: { consumed: 550 + index * 2, limit: 2000 },
          delta: 50,
          pct: 10.0,
          regression: true,
        },
        {
          key: "events_count" as const,
          base: { consumed: 50 + index, limit: 200 },
          head: { consumed: 55 + index, limit: 200 },
          delta: 5,
          pct: 10.0,
          regression: true,
        },
        {
          key: "event_data_bytes" as const,
          base: { consumed: 1000 + index * 10, limit: 5000 },
          head: { consumed: 1100 + index * 10, limit: 5000 },
          delta: 100,
          pct: 10.0,
          regression: true,
        },
      ],
    }));

    const comment = renderComment(diff, [], "main", "abcdef12345678");

    // Verify the comment is truncated to stay under the safe limit
    expect(comment.length).toBeLessThanOrEqual(MAX_COMMENT_LENGTH);

    // Verify the truncation notice is appended
    expect(comment).toContain(TRUNCATION_NOTICE.trim());
    expect(comment).toContain("⚠️ **Report truncated**");

    // Verify the marker is still present (it should be before the truncation notice)
    expect(comment).toContain("<!-- weighin-report -->");
  });

  it("generates valid Markdown table with correct headers for single contract", () => {
    const diff = createMockDiff(true); // Use regression to get non-zero delta
    const comment = renderComment(diff, [], "main", "abcdef123");

    // Verify function table headers
    expect(comment).toContain(
      "| | Metric | Base | Head | Delta | Change | Limit |",
    );
    expect(comment).toContain("|---|---|---|---|---|---|---|");

    // Verify pipe delimiters are present (valid Markdown table syntax)
    const tableLines = comment
      .split("\n")
      .filter((line) => line.startsWith("|") && line.includes("Metric"));
    expect(tableLines.length).toBeGreaterThan(0);

    // Verify values are formatted with thousands separators
    expect(comment).toContain("1,000"); // Limit value with comma separator
    expect(comment).toContain("100"); // Base value
    expect(comment).toContain("110"); // Head value (with regression)
  });

  it("generates valid Markdown table with correct headers for multi-contract diff", () => {
    const diff = createMockDiff(false);
    // Add a second contract
    diff.contracts.push({
      fixture_id: "path:fixtures-b.json",
      logical_id: "id:contract-b",
      contract_id: "contract-b",
      base_contract_id: "base-contract-b",
      head_contract_id: "contract-b",
      base_commit: "abc",
      head_commit: "def",
      hasRegression: false,
      newFunctions: [],
      removedFunctions: [],
      newBenchmarks: [],
      removedBenchmarks: [],
      functions: [
        {
          function_name: "contract-b-fn",
          hasRegression: false,
          metrics: [
            {
              key: "cpu_instructions",
              base: { consumed: 2000, limit: 5000 },
              head: { consumed: 2500, limit: 5000 },
              delta: 500,
              pct: 25.0,
              regression: true,
            },
            {
              key: "memory_bytes",
              base: { consumed: 10000, limit: 50000 },
              head: { consumed: 12000, limit: 50000 },
              delta: 2000,
              pct: 20.0,
              regression: true,
            },
          ],
        },
      ],
    });

    const comment = renderComment(diff, [], "main", "abcdef123");

    // Verify both contracts have their tables (using contractLabel format)
    expect(comment).toContain(
      "### Contract `path:fixtures.json / id:contract-a`",
    );
    expect(comment).toContain(
      "### Contract `path:fixtures-b.json / id:contract-b`",
    );

    // Verify function table headers appear for each contract
    const headerCount = (comment.match(/\| \|\s*Metric\s*\|/g) || []).length;
    expect(headerCount).toBe(2); // One per contract

    // Verify pipe delimiters throughout
    const tableRows = comment
      .split("\n")
      .filter((line) => line.startsWith("|") && line.includes("|"));
    expect(tableRows.length).toBeGreaterThan(4); // Headers + separator + data rows for both contracts

    // Verify values are formatted with thousands separators
    expect(comment).toContain("5,000"); // Limit value with comma
    expect(comment).toContain("2,500"); // Head value with comma
    expect(comment).toContain("12,000"); // Head value with comma
  });

  it("formats numeric values with thousands separators in tables", () => {
    const diff = createMockDiff(false);
    diff.contracts[0].functions[0].metrics = [
      {
        key: "cpu_instructions",
        base: { consumed: 1000000, limit: 5000000 },
        head: { consumed: 1500000, limit: 5000000 },
        delta: 500000,
        pct: 50.0,
        regression: true,
      },
      {
        key: "memory_bytes",
        base: { consumed: 2500000, limit: 10000000 },
        head: { consumed: 3000000, limit: 10000000 },
        delta: 500000,
        pct: 20.0,
        regression: true,
      },
    ];

    const comment = renderComment(diff, [], "main", "abcdef123");

    // Verify large numbers are formatted with commas
    expect(comment).toContain("1,000,000"); // Base
    expect(comment).toContain("1,500,000"); // Head
    expect(comment).toContain("5,000,000"); // Limit
    expect(comment).toContain("2,500,000"); // Base memory
    expect(comment).toContain("3,000,000"); // Head memory
    expect(comment).toContain("10,000,000"); // Limit memory
  });

  it("renders valid Markdown pipe-delimited tables for aggregate budgets", () => {
    const diff = createMockDiff(false);
    diff.aggregates = [
      {
        name: "test-aggregate",
        member_count: 2,
        description: "Test aggregate",
        provenance: {
          source: "soroban-simulation",
          protocol_version: 28,
          network_passphrase: "test-network",
        },
        metrics: [
          {
            key: "cpu_instructions",
            base_consumed: 100000,
            head_consumed: 120000,
            delta: 20000,
            pct: 20.0,
            regression: true,
            availability: "available",
            description: "Compute units",
          },
          {
            key: "memory_bytes",
            base_consumed: 500000,
            head_consumed: 600000,
            delta: 100000,
            pct: 20.0,
            regression: true,
            availability: "available",
            description: "Memory bytes",
          },
        ],
        breakdown: {
          cpu_instructions: [
            {
              logical_id: "member-1",
              contract_id: "contract-1",
              function_name: "fn1",
              case_id: "case1",
              base_consumed: 50000,
              head_consumed: 60000,
            },
            {
              logical_id: "member-2",
              contract_id: "contract-2",
              function_name: "fn2",
              case_id: "case2",
              base_consumed: 50000,
              head_consumed: 60000,
            },
          ],
          memory_bytes: [
            {
              logical_id: "member-1",
              contract_id: "contract-1",
              function_name: "fn1",
              case_id: "case1",
              base_consumed: 250000,
              head_consumed: 300000,
            },
            {
              logical_id: "member-2",
              contract_id: "contract-2",
              function_name: "fn2",
              case_id: "case2",
              base_consumed: 250000,
              head_consumed: 300000,
            },
          ],
        },
      },
    ];

    const comment = renderComment(diff, [], "main", "abcdef123");

    // Verify aggregate budgets table headers
    expect(comment).toContain(
      "| | Metric | Base (Sum) | Head (Sum) | Delta | Change | Semantic Unit |",
    );
    expect(comment).toContain("|---|---|---|---|---|---|---|");

    // Verify aggregate table data rows
    expect(comment).toContain("CPU Instructions");
    expect(comment).toContain("Memory Bytes");
    expect(comment).toContain("100,000");
    expect(comment).toContain("120,000");
    expect(comment).toContain("500,000");
    expect(comment).toContain("600,000");

    // Verify member breakdown table
    expect(comment).toContain(
      "| Member | Function | Case | CPU Instructions (Base → Head) | Memory Bytes (Base → Head) |",
    );
    expect(comment).toContain("|---|---|---|---|---|");
    expect(comment).toContain("member-1");
    expect(comment).toContain("member-2");
    expect(comment).toContain("50,000 → 60,000");
    expect(comment).toContain("250,000 → 300,000");
  });

  it("renders valid Markdown pipe-delimited tables for policy rules", () => {
    const diff = createMockDiff(false);
    const effectivePolicy = {
      status: "active" as const,
      mode: "head" as const,
      path: "weighin.toml",
      revision: "abc123",
      content_sha256: "sha256hash",
      rules: [
        {
          target: "contract-a::test-fn",
          metric: "cpu_instructions",
          rule: "relative: +10%",
          source: "weighin.toml",
        },
        {
          target: "global",
          metric: "memory_bytes",
          rule: "absolute: 1000000",
          source: "weighin.toml",
        },
      ],
    };

    const comment = renderComment(
      diff,
      [],
      "main",
      "abcdef123",
      effectivePolicy,
    );

    // Verify policy rules table
    expect(comment).toContain(
      "<details><summary>Effective Policy Rules</summary>",
    );
    expect(comment).toContain("| Target | Metric | Effective Rule | Source |");
    expect(comment).toContain("| :--- | :--- | :--- | :--- |");
    expect(comment).toContain(
      "| `contract-a::test-fn` | CPU Instructions | `relative: +10%` | weighin.toml |",
    );
    expect(comment).toContain(
      "| `global` | Memory Bytes | `absolute: 1000000` | weighin.toml |",
    );
  });
});

describe("findReportComment unit tests", () => {
  function createMockOctokit(
    pages: Array<Array<{ id: number; body?: string | null }>>,
    failOnPage?: number,
  ) {
    const requestedPages: number[] = [];
    return {
      requestedPages,
      rest: {
        issues: {
          listComments: () => {},
        },
      },
      paginate: {
        iterator: async function* () {
          for (let i = 0; i < pages.length; i++) {
            requestedPages.push(i + 1);
            if (failOnPage === i + 1) {
              throw new Error(`Simulated API failure on page ${i + 1}`);
            }
            yield { data: pages[i] };
          }
        },
      },
    };
  }

  it("finds comment on page 2 and stops traversing before page 3", async () => {
    const mock = createMockOctokit([
      [{ id: 1, body: "Discussion item 1" }],
      [{ id: 2, body: `Report: ${COMMENT_MARKER}` }],
      [{ id: 3, body: "Discussion item 2" }],
    ]);
    const comment = await findReportComment(mock, "owner", "repo", 42);
    expect(comment?.id).toBe(2);
    expect(mock.requestedPages).toEqual([1, 2]);
  });

  it("reaches exhaustion across all pages when no marker exists", async () => {
    const mock = createMockOctokit([
      [{ id: 1, body: "Comment 1" }],
      [{ id: 2, body: "Comment 2" }],
      [{ id: 3, body: "Comment 3" }],
    ]);
    const comment = await findReportComment(mock, "owner", "repo", 42);
    expect(comment).toBeUndefined();
    expect(mock.requestedPages).toEqual([1, 2, 3]);
  });

  it("traverses past an empty first page and finds marker on page 2", async () => {
    const mock = createMockOctokit([
      [],
      [{ id: 20, body: `Previous run: ${COMMENT_MARKER}` }],
    ]);
    const comment = await findReportComment(mock, "owner", "repo", 42);
    expect(comment?.id).toBe(20);
    expect(mock.requestedPages).toEqual([1, 2]);
  });

  it("preserves selection of the first matching marker on a page with multiple markers", async () => {
    const mock = createMockOctokit([
      [
        { id: 11, body: `First: ${COMMENT_MARKER}` },
        { id: 12, body: `Second: ${COMMENT_MARKER}` },
      ],
      [{ id: 13, body: `Third: ${COMMENT_MARKER}` }],
    ]);
    const comment = await findReportComment(mock, "owner", "repo", 42);
    expect(comment?.id).toBe(11);
    expect(mock.requestedPages).toEqual([1]);
  });

  it("propagates API failure during pagination without suppressing error", async () => {
    const mock = createMockOctokit(
      [[{ id: 1, body: "Comment 1" }], [{ id: 2, body: "Comment 2" }]],
      2,
    );
    await expect(findReportComment(mock, "owner", "repo", 42)).rejects.toThrow(
      "Simulated API failure on page 2",
    );
    expect(mock.requestedPages).toEqual([1, 2]);
  });
});

describe("upsertPrComment public API with paginated transport", () => {
  interface RecordedCall {
    method: string;
    url: string;
    body?: any;
    commentId?: number;
  }

  let server: http.Server;
  const calls: RecordedCall[] = [];
  let origUrl: string | undefined;
  let origRepo: string | undefined;

  beforeAll(async () => {
    origUrl = process.env.GITHUB_API_URL;
    origRepo = process.env.GITHUB_REPOSITORY;
    process.env.GITHUB_REPOSITORY = "WeighInNG/WeighIn";

    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const url = new URL(
          req.url || "/",
          `http://${req.headers.host || "127.0.0.1"}`,
        );
        const parsedBody = raw ? JSON.parse(raw) : undefined;

        // PR 91: page 2 contains report
        if (url.pathname === "/repos/WeighInNG/WeighIn/issues/91/comments") {
          if (req.method === "GET") {
            const page = parseInt(url.searchParams.get("page") || "1", 10);
            calls.push({ method: "GET", url: req.url || "" });
            if (page === 1) {
              res.writeHead(200, {
                "content-type": "application/json",
                link: `<http://${req.headers.host}${url.pathname}?page=2>; rel="next"`,
                connection: "close",
              });
              res.end(
                JSON.stringify([{ id: 101, body: "Non-marker comment" }]),
              );
            } else {
              res.writeHead(200, {
                "content-type": "application/json",
                connection: "close",
              });
              res.end(
                JSON.stringify([
                  {
                    id: 102,
                    body: `Existing report ${COMMENT_MARKER}`,
                    user: { id: 41898282 },
                  },
                ]),
              );
            }
            return;
          }
        }

        // PR 92: exhaustion without report
        if (url.pathname === "/repos/WeighInNG/WeighIn/issues/92/comments") {
          if (req.method === "GET") {
            const page = parseInt(url.searchParams.get("page") || "1", 10);
            calls.push({ method: "GET", url: req.url || "" });
            if (page === 1) {
              res.writeHead(200, {
                "content-type": "application/json",
                link: `<http://${req.headers.host}${url.pathname}?page=2>; rel="next"`,
                connection: "close",
              });
              res.end(JSON.stringify([{ id: 201, body: "Page 1 non-marker" }]));
            } else {
              res.writeHead(200, {
                "content-type": "application/json",
                connection: "close",
              });
              res.end(JSON.stringify([{ id: 202, body: "Page 2 non-marker" }]));
            }
            return;
          }
          if (req.method === "POST") {
            calls.push({
              method: "POST",
              url: req.url || "",
              body: parsedBody,
            });
            res.writeHead(201, {
              "content-type": "application/json",
              connection: "close",
            });
            res.end(JSON.stringify({ id: 999, body: parsedBody?.body }));
            return;
          }
        }

        // PR 93: failure on GET
        if (url.pathname === "/repos/WeighInNG/WeighIn/issues/93/comments") {
          if (req.method === "GET") {
            calls.push({ method: "GET", url: req.url || "" });
            res.writeHead(500, {
              "content-type": "application/json",
              connection: "close",
            });
            res.end(JSON.stringify({ message: "Simulated upstream failure" }));
            return;
          }
        }

        // Comment update
        const match = url.pathname.match(
          /^\/repos\/WeighInNG\/WeighIn\/issues\/comments\/(\d+)$/,
        );
        if (match && req.method === "PATCH") {
          const commentId = parseInt(match[1], 10);
          calls.push({
            method: "PATCH",
            url: req.url || "",
            commentId,
            body: parsedBody,
          });
          res.writeHead(200, {
            "content-type": "application/json",
            connection: "close",
          });
          res.end(JSON.stringify({ id: commentId, body: parsedBody?.body }));
          return;
        }

        res.writeHead(400, { connection: "close" });
        res.end("Unexpected test API request");
      });
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as any).port;
    process.env.GITHUB_API_URL = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    process.env.GITHUB_API_URL = origUrl;
    process.env.GITHUB_REPOSITORY = origRepo;
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("updates report on page 2 without creating a new comment", async () => {
    calls.length = 0;
    await upsertPrComment(
      "test-token",
      91,
      `New report body ${COMMENT_MARKER}`,
    );
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "PATCH"]);
    expect(calls[2].commentId).toBe(102);
    expect(calls[2].body.body).toBe(`New report body ${COMMENT_MARKER}`);
  });

  it("reaches exhaustion before creating a new report when no marker exists", async () => {
    calls.length = 0;
    await upsertPrComment("test-token", 92, `Created report ${COMMENT_MARKER}`);
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "POST"]);
    expect(calls[2].body.body).toBe(`Created report ${COMMENT_MARKER}`);
  });

  it("fails closed on API error without creating or updating comment", async () => {
    calls.length = 0;
    await expect(
      upsertPrComment("test-token", 93, `Report ${COMMENT_MARKER}`),
    ).rejects.toThrow();
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });
});

describe("bundled entry points consistency", () => {
  it("bundled/index.js and bundled/comment-action.js use shared paginated lookup", () => {
    const root = path.resolve(__dirname, "..");
    const bundledAction = fs.readFileSync(
      path.join(root, "bundled/index.js"),
      "utf8",
    );
    const bundledCommentAction = fs.readFileSync(
      path.join(root, "bundled/comment-action.js"),
      "utf8",
    );

    // Both bundles must include the paginated iterator
    expect(bundledAction).toContain("paginate.iterator");
    expect(bundledCommentAction).toContain("paginate.iterator");

    // Both bundles must use the shared findReportComment logic
    expect(bundledAction).toContain("findReportComment");
    expect(bundledCommentAction).toContain("findReportComment");
  });
});
