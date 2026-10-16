import { describe, it, expect } from "vitest";
import { renderComment } from "../src/comment";
import { DiffResult } from "../src/diff";
import { Violation } from "../src/threshold";

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
});
