import { describe, it, expect } from "vitest";
import {
  enforceThresholds,
  GlobalThresholds,
  WeighinConfig,
} from "../src/threshold";
import {
  diffBenchmarks,
  DiffResult,
  METRIC_KEYS,
  MetricKey,
} from "../src/diff";
import { ContractBenchmark, Metrics } from "../src/measurement";

function createMetricsWithOverride(
  key: MetricKey,
  consumed: number,
  defaultConsumed = 100,
): Metrics {
  const metrics = {} as Metrics;
  for (const metricKey of METRIC_KEYS) {
    metrics[metricKey] = {
      consumed: metricKey === key ? consumed : defaultConsumed,
      limit: 0,
    };
  }
  return metrics;
}

function createBenchmarkDiff(
  key: MetricKey,
  baseConsumed: number,
  headConsumed: number,
  config?: WeighinConfig,
): DiffResult {
  const base: ContractBenchmark[] = [
    {
      contract_id: "contract-a",
      git_commit: "abc",
      soroban_sdk_version: "1.0",
      timestamp: 0,
      benchmarks: [
        {
          function_name: "test-fn",
          wasm_sha256: "base-wasm",
          metrics: createMetricsWithOverride(key, baseConsumed),
        },
      ],
    },
  ];
  const head: ContractBenchmark[] = [
    {
      contract_id: "contract-a",
      git_commit: "def",
      soroban_sdk_version: "1.0",
      timestamp: 1,
      benchmarks: [
        {
          function_name: "test-fn",
          wasm_sha256: "head-wasm",
          metrics: createMetricsWithOverride(key, headConsumed),
        },
      ],
    },
  ];
  return diffBenchmarks(base, head, config);
}

function createMockDiff(
  key: MetricKey,
  delta: number,
  pct: number | null,
  regression: boolean,
): DiffResult {
  return {
    contracts: [
      {
        contract_id: "contract-a",
        base_commit: "abc",
        head_commit: "def",
        hasRegression: regression,
        newFunctions: [],
        removedFunctions: [],
        functions: [
          {
            function_name: "test-fn",
            hasRegression: regression,
            metrics: METRIC_KEYS.map((metricKey) =>
              metricKey === key
                ? {
                    key: metricKey,
                    base: { consumed: 100, limit: 0 },
                    head: { consumed: 100 + delta, limit: 0 },
                    delta,
                    pct,
                    regression,
                    availability: "comparable" as const,
                  }
                : {
                    key: metricKey,
                    base: { consumed: 100, limit: 0 },
                    head: { consumed: 100, limit: 0 },
                    delta: 0,
                    pct: 0,
                    regression: false,
                    availability: "comparable" as const,
                  },
            ),
          },
        ],
      },
    ],
    hasRegression: regression,
    newContracts: [],
    removedContracts: [],
  };
}

describe("enforceThresholds", () => {
  it("accepts a complete diff whose derived policy metrics agree", () => {
    expect(
      enforceThresholds(createMockDiff("cpu_instructions", 10, 10, true), null),
    ).toEqual([]);
  });

  it("rejects contradictory and incomplete public DiffResult metrics", () => {
    const contradictory = createMockDiff("cpu_instructions", 10, 10, true);
    contradictory.contracts[0].functions[0].metrics[0].delta = 99;
    expect(() => enforceThresholds(contradictory, null)).toThrow(
      /delta contradict base\/head consumed values/,
    );

    const inconsistentAvailability = createMockDiff(
      "cpu_instructions",
      10,
      10,
      true,
    );
    inconsistentAvailability.contracts[0].functions[0].metrics[0].base.availability =
      "unavailable";
    expect(() => enforceThresholds(inconsistentAvailability, null)).toThrow(
      /availability.*must agree/,
    );

    const incomplete = createMockDiff("cpu_instructions", 10, 10, true);
    incomplete.contracts[0].functions[0].metrics.pop();
    expect(() =>
      enforceThresholds(incomplete, {
        thresholds: { global: { fail_on_any_regression: true } },
      }),
    ).toThrow(/all supported metrics are required/);
  });

  it("returns empty violations if config or thresholds are empty", () => {
    const diff = createMockDiff("cpu_instructions", 10, 10, true);
    expect(enforceThresholds(diff, null)).toEqual([]);
    expect(enforceThresholds(diff, {})).toEqual([]);
    expect(enforceThresholds(diff, { thresholds: {} })).toEqual([]);
  });

  it("requires a matched benchmark for configured global absolute limits", () => {
    const emptyDiff: DiffResult = {
      contracts: [],
      hasRegression: false,
      newContracts: [],
      removedContracts: [],
    };
    const config: WeighinConfig = {
      limits: { global: { cpu_instructions: 100 } },
    };

    expect(() => enforceThresholds(emptyDiff, config)).toThrow(
      /global policy or limits: no matched BASE\/HEAD benchmarks/,
    );
    expect(enforceThresholds(emptyDiff, { limits: { global: {} } })).toEqual(
      [],
    );
    expect(enforceThresholds(emptyDiff, null)).toEqual([]);
  });

  it("rejects global absolute limits when all cases are unmatched", () => {
    const diff: DiffResult = {
      contracts: [
        {
          contract_id: "contract-a",
          base_contract_id: "base-contract",
          head_contract_id: "head-contract",
          base_commit: "abc",
          head_commit: "def",
          functions: [],
          hasRegression: false,
          newFunctions: ["new-fn"],
          removedFunctions: [],
          newBenchmarks: [{ function_name: "new-fn", case_id: "args:[]" }],
          removedBenchmarks: [],
        },
      ],
      hasRegression: false,
      newContracts: [],
      removedContracts: [],
    };

    expect(() =>
      enforceThresholds(diff, {
        limits: { global: { cpu_instructions: 100 } },
      }),
    ).toThrow(/no matched BASE\/HEAD benchmarks/);
  });

  it("handles fail_on_any_regression", () => {
    const diff = createMockDiff("cpu_instructions", 10, 10, true);
    const config: WeighinConfig = {
      thresholds: { global: { fail_on_any_regression: true } },
    };
    const violations = enforceThresholds(diff, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("fail_on_any_regression");
  });

  it("respects max_allowed_cpu_increase_pct global rule", () => {
    const diff = createMockDiff("cpu_instructions", 10, 10, true); // 10% increase
    const config: WeighinConfig = {
      thresholds: { global: { max_allowed_cpu_increase_pct: 5 } },
    };
    const violations = enforceThresholds(diff, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("allow_5_percent_increase");

    const configPass: WeighinConfig = {
      thresholds: { global: { max_allowed_cpu_increase_pct: 15 } },
    };
    expect(enforceThresholds(diff, configPass)).toEqual([]);
  });

  it("strict_zero_tolerance catches any regression", () => {
    const diff = createMockDiff("events_count", 1, 1, true);
    const config: WeighinConfig = {
      thresholds: {
        functions: { "test-fn": { events_count: "strict_zero_tolerance" } },
      },
    };
    const violations = enforceThresholds(diff, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("strict_zero_tolerance");
  });

  it("strict_zero_tolerance passes if no regression", () => {
    const diff = createMockDiff("events_count", -1, -1, false);
    const config: WeighinConfig = {
      thresholds: {
        functions: { "test-fn": { events_count: "strict_zero_tolerance" } },
      },
    };
    const violations = enforceThresholds(diff, config);
    expect(violations).toEqual([]); // No violation if improvement
  });

  it("ignore rule skips violations even with global fail_on_any_regression", () => {
    const diff = createMockDiff("cpu_instructions", 10, 10, true);
    const config: WeighinConfig = {
      thresholds: {
        global: { fail_on_any_regression: true },
        functions: { "test-fn": { cpu_instructions: "ignore" } },
      },
    };
    const violations = enforceThresholds(diff, config);
    expect(violations).toEqual([]);
  });

  it("handles Infinity percentage (division by zero) correctly", () => {
    const diff = createMockDiff("cpu_instructions", 10, null, true);
    diff.contracts[0].functions[0].metrics[0].base.consumed = 0;
    diff.contracts[0].functions[0].metrics[0].head.consumed = 10;
    const config: WeighinConfig = {
      thresholds: { global: { max_allowed_cpu_increase_pct: 100 } },
    };
    const violations = enforceThresholds(diff, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("Infinity");
  });

  describe("zero baseline with nonzero head", () => {
    // A newly introduced resource (base = 0, head = 10) has no finite
    // percentage change, so policy evaluation must not divide by zero.
    function zeroBaselineDiff(): DiffResult {
      const diff = createMockDiff("ledger_write_entries", 10, null, true);
      const metric = diff.contracts[0].functions[0].metrics.find(
        (m) => m.key === "ledger_write_entries",
      )!;
      metric.base.consumed = 0;
      metric.head.consumed = 10;
      return diff;
    }

    it("fails strict_zero_tolerance with the absolute increase", () => {
      const config: WeighinConfig = {
        thresholds: {
          functions: {
            "test-fn": { ledger_write_entries: "strict_zero_tolerance" },
          },
        },
      };
      const violations = enforceThresholds(zeroBaselineDiff(), config);
      expect(violations).toEqual([
        expect.objectContaining({
          contract_id: "contract-a",
          function_name: "test-fn",
          metric: "ledger_write_entries",
          delta: 10,
          pct: null,
          rule: "strict_zero_tolerance",
          message:
            "ledger_write_entries increased by 10 (strict zero tolerance)",
        }),
      ]);
    });

    it.each([
      ["named rule", "allow_50_percent_increase"],
      ["numeric cap", 50],
    ] as const)(
      "returns a structured violation for a percentage %s instead of NaN",
      (_label, rule) => {
        const config: WeighinConfig = {
          thresholds: {
            functions: { "test-fn": { ledger_write_entries: rule } },
          },
        };
        let violations: ReturnType<typeof enforceThresholds> = [];
        expect(() => {
          violations = enforceThresholds(zeroBaselineDiff(), config);
        }).not.toThrow();
        expect(violations).toHaveLength(1);
        const [violation] = violations;
        expect(violation).toMatchObject({
          metric: "ledger_write_entries",
          delta: 10,
          pct: null,
          rule: "allow_50_percent_increase",
          message: "ledger_write_entries increased by Infinity% (limit 50%)",
        });
        expect(Number.isNaN(violation.delta)).toBe(false);
        expect(violation.message).not.toContain("NaN");
      },
    );
  });

  describe("Absolute limits", () => {
    it("fails when absolute limit is exceeded", () => {
      const config = {
        limits: {
          global: {
            cpu_instructions: 50,
          },
        },
      };
      const diff = createMockDiff("cpu_instructions", 41, 410, true);
      diff.contracts[0].functions[0].metrics[0].base.consumed = 10;
      diff.contracts[0].functions[0].metrics[0].head.consumed = 51;
      diff.contracts[0].functions[0].metrics[0].pct = (41 / 10) * 100;

      const v = enforceThresholds(diff as any, config as any);
      expect(v).toHaveLength(1);
      expect(v[0].rule).toBe("absolute_limit(50)");
      expect(v[0].message).toContain("exceeded absolute limit");
    });

    it("passes when absolute limit is exactly met or below", () => {
      const config = {
        limits: {
          global: {
            cpu_instructions: 51,
          },
          functions: {
            "test-fn": {
              memory_bytes: 50,
            },
          },
        },
      };
      const diff = createMockDiff("cpu_instructions", 51, null, true);
      const cpu = diff.contracts[0].functions[0].metrics.find(
        (metric) => metric.key === "cpu_instructions",
      )!;
      cpu.base.consumed = 0;
      cpu.head.consumed = 51;
      const memory = diff.contracts[0].functions[0].metrics.find(
        (metric) => metric.key === "memory_bytes",
      )!;
      memory.base.consumed = 0;
      memory.head.consumed = 40;
      memory.delta = 40;
      memory.pct = null;
      memory.regression = true;

      const v = enforceThresholds(diff as any, config as any);
      expect(v).toHaveLength(0);
    });

    it("evaluates absolute and regression limits independently (both fail)", () => {
      const config = {
        limits: {
          global: { cpu_instructions: 50 },
        },
        thresholds: {
          global: { max_allowed_cpu_increase_pct: 10 },
        },
      };
      const diff = createMockDiff("cpu_instructions", 41, 410, true);
      diff.contracts[0].functions[0].metrics[0].base.consumed = 10;
      diff.contracts[0].functions[0].metrics[0].head.consumed = 51;
      diff.contracts[0].functions[0].metrics[0].pct = (41 / 10) * 100;
      const v = enforceThresholds(diff as any, config as any);
      expect(v).toHaveLength(2);
      expect(v[0].rule).toBe("absolute_limit(50)");
      expect(v[1].rule).toBe("allow_10_percent_increase");
    });
  });

  describe("Percentage delta and threshold bounds", () => {
    it("passes when Base 100 -> Head 104 is within a 5% threshold", () => {
      const cpuDiff = createBenchmarkDiff("cpu_instructions", 100, 104);
      const cpuMetric = cpuDiff.contracts[0].functions[0].metrics.find(
        (m) => m.key === "cpu_instructions",
      )!;
      expect(cpuMetric.delta).toBe(4);
      expect(cpuMetric.pct).toBe(4);
      expect(cpuMetric.regression).toBe(true);

      // Global CPU threshold (5%)
      expect(
        enforceThresholds(cpuDiff, {
          thresholds: { global: { max_allowed_cpu_increase_pct: 5 } },
        }),
      ).toEqual([]);

      // Per-function named policy ("allow_5_percent_increase") and numeric cap (5)
      expect(
        enforceThresholds(cpuDiff, {
          thresholds: {
            functions: {
              "test-fn": { cpu_instructions: "allow_5_percent_increase" },
            },
          },
        }),
      ).toEqual([]);
      expect(
        enforceThresholds(cpuDiff, {
          thresholds: {
            functions: { "test-fn": { cpu_instructions: 5 } },
          },
        }),
      ).toEqual([]);

      // Global memory threshold (5%)
      const memDiff = createBenchmarkDiff("memory_bytes", 100, 104);
      expect(
        enforceThresholds(memDiff, {
          thresholds: { global: { max_allowed_memory_increase_pct: 5 } },
        }),
      ).toEqual([]);

      // Exact boundary: Base 100 -> Head 105 with 5% threshold also passes
      const exactBoundaryDiff = createBenchmarkDiff(
        "cpu_instructions",
        100,
        105,
      );
      expect(
        enforceThresholds(exactBoundaryDiff, {
          thresholds: { global: { max_allowed_cpu_increase_pct: 5 } },
        }),
      ).toEqual([]);
    });

    it("fails when Base 100 -> Head 106 exceeds a 5% threshold", () => {
      const cpuDiff = createBenchmarkDiff("cpu_instructions", 100, 106);
      const cpuMetric = cpuDiff.contracts[0].functions[0].metrics.find(
        (m) => m.key === "cpu_instructions",
      )!;
      expect(cpuMetric.delta).toBe(6);
      expect(cpuMetric.pct).toBe(6);
      expect(cpuMetric.regression).toBe(true);

      // Global CPU threshold (5%)
      const globalViolations = enforceThresholds(cpuDiff, {
        thresholds: { global: { max_allowed_cpu_increase_pct: 5 } },
      });
      expect(globalViolations).toHaveLength(1);
      expect(globalViolations[0]).toMatchObject({
        contract_id: "contract-a",
        function_name: "test-fn",
        metric: "cpu_instructions",
        delta: 6,
        pct: 6,
        rule: "allow_5_percent_increase",
      });
      expect(globalViolations[0].message).toBe(
        "cpu_instructions increased by 6.00% (limit 5%)",
      );

      // Per-function named and numeric 5% policies
      const namedViolations = enforceThresholds(cpuDiff, {
        thresholds: {
          functions: {
            "test-fn": { cpu_instructions: "allow_5_percent_increase" },
          },
        },
      });
      expect(namedViolations).toHaveLength(1);
      expect(namedViolations[0].rule).toBe("allow_5_percent_increase");
      expect(namedViolations[0].pct).toBe(6);

      const numericViolations = enforceThresholds(cpuDiff, {
        thresholds: {
          functions: { "test-fn": { cpu_instructions: 5 } },
        },
      });
      expect(numericViolations).toHaveLength(1);
      expect(numericViolations[0].rule).toBe("allow_5_percent_increase");

      // Global memory threshold (5%)
      const memDiff = createBenchmarkDiff("memory_bytes", 100, 106);
      const memViolations = enforceThresholds(memDiff, {
        thresholds: { global: { max_allowed_memory_increase_pct: 5 } },
      });
      expect(memViolations).toHaveLength(1);
      expect(memViolations[0]).toMatchObject({
        metric: "memory_bytes",
        delta: 6,
        pct: 6,
        rule: "allow_5_percent_increase",
      });
    });

    it("handles Base 0 -> Head 50 without division by zero", () => {
      const zeroBaseDiff = createBenchmarkDiff("cpu_instructions", 0, 50);
      const cpuMetric = zeroBaseDiff.contracts[0].functions[0].metrics.find(
        (m) => m.key === "cpu_instructions",
      )!;
      expect(cpuMetric.base.consumed).toBe(0);
      expect(cpuMetric.head.consumed).toBe(50);
      expect(cpuMetric.delta).toBe(50);
      expect(cpuMetric.pct).toBeNull();
      expect(cpuMetric.regression).toBe(true);

      // Positive regression from 0 fails percentage threshold cleanly as Infinity%
      const violations = enforceThresholds(zeroBaseDiff, {
        thresholds: { global: { max_allowed_cpu_increase_pct: 5 } },
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        contract_id: "contract-a",
        function_name: "test-fn",
        metric: "cpu_instructions",
        delta: 50,
        pct: null,
        rule: "allow_5_percent_increase",
      });
      expect(violations[0].message).toBe(
        "cpu_instructions increased by Infinity% (limit 5%)",
      );

      // Even a very high percentage cap still flags a 0 -> 50 regression
      const highCapViolations = enforceThresholds(zeroBaseDiff, {
        thresholds: {
          functions: {
            "test-fn": { cpu_instructions: "allow_1000_percent_increase" },
          },
        },
      });
      expect(highCapViolations).toHaveLength(1);
      expect(highCapViolations[0].pct).toBeNull();
      expect(highCapViolations[0].message).toContain("Infinity%");

      // Explicit ignore still bypasses the 0 -> 50 regression
      expect(
        enforceThresholds(zeroBaseDiff, {
          thresholds: {
            global: { max_allowed_cpu_increase_pct: 5 },
            functions: { "test-fn": { cpu_instructions: "ignore" } },
          },
        }),
      ).toEqual([]);

      // Base 0 -> Head 0 has no regression and passes cleanly
      const zeroToZeroDiff = createBenchmarkDiff("cpu_instructions", 0, 0);
      expect(
        enforceThresholds(zeroToZeroDiff, {
          thresholds: {
            global: {
              fail_on_any_regression: true,
              max_allowed_cpu_increase_pct: 5,
            },
          },
        }),
      ).toEqual([]);

      // Public DiffResult validation rejects non-null pct when base is 0
      const forgedDiff = createBenchmarkDiff("cpu_instructions", 0, 50);
      forgedDiff.contracts[0].functions[0].metrics[0].pct = Infinity;
      expect(() =>
        enforceThresholds(forgedDiff, {
          thresholds: { global: { max_allowed_cpu_increase_pct: 5 } },
        }),
      ).toThrow(/pct contradict base\/head consumed values/);
    });

    it("always passes negative delta (performance improvement) under positive regression thresholds", () => {
      const improvedDiff = createBenchmarkDiff("cpu_instructions", 100, 80);
      const cpuMetric = improvedDiff.contracts[0].functions[0].metrics.find(
        (m) => m.key === "cpu_instructions",
      )!;
      expect(cpuMetric.delta).toBe(-20);
      expect(cpuMetric.pct).toBe(-20);
      expect(cpuMetric.regression).toBe(false);

      // Passes global 5% threshold
      expect(
        enforceThresholds(improvedDiff, {
          thresholds: { global: { max_allowed_cpu_increase_pct: 5 } },
        }),
      ).toEqual([]);

      // Passes global 0% threshold and fail_on_any_regression
      expect(
        enforceThresholds(improvedDiff, {
          thresholds: {
            global: {
              max_allowed_cpu_increase_pct: 0,
              fail_on_any_regression: true,
            },
          },
        }),
      ).toEqual([]);

      // Passes per-function named, numeric, and strict_zero_tolerance policies
      expect(
        enforceThresholds(improvedDiff, {
          thresholds: {
            functions: {
              "test-fn": { cpu_instructions: "allow_5_percent_increase" },
            },
          },
        }),
      ).toEqual([]);
      expect(
        enforceThresholds(improvedDiff, {
          thresholds: {
            functions: { "test-fn": { cpu_instructions: 5 } },
          },
        }),
      ).toEqual([]);
      expect(
        enforceThresholds(improvedDiff, {
          thresholds: {
            functions: {
              "test-fn": { cpu_instructions: "strict_zero_tolerance" },
            },
          },
        }),
      ).toEqual([]);

      // Large negative delta (Base 100 -> Head 0, -100%) also passes
      const zeroHeadDiff = createBenchmarkDiff("memory_bytes", 100, 0);
      expect(
        enforceThresholds(zeroHeadDiff, {
          thresholds: { global: { max_allowed_memory_increase_pct: 5 } },
        }),
      ).toEqual([]);
    });

    it("enforces percentage bounds consistently for aggregate thresholds", () => {
      const aggregateConfig: WeighinConfig = {
        aggregates: {
          "flow-cpu": {
            members: [{ function_name: "test-fn" }],
            thresholds: { cpu_instructions: "allow_5_percent_increase" },
          },
        },
      };

      // Base 100 -> Head 104 with 5% threshold -> PASS
      expect(
        enforceThresholds(
          createBenchmarkDiff("cpu_instructions", 100, 104, aggregateConfig),
          aggregateConfig,
        ),
      ).toEqual([]);

      // Base 100 -> Head 106 with 5% threshold -> FAIL
      const overLimit = enforceThresholds(
        createBenchmarkDiff("cpu_instructions", 100, 106, aggregateConfig),
        aggregateConfig,
      );
      expect(overLimit).toHaveLength(1);
      expect(overLimit[0]).toMatchObject({
        aggregate_id: "flow-cpu",
        metric: "cpu_instructions",
        delta: 6,
        pct: 6,
        rule: "allow_5_percent_increase",
      });

      // Base 0 -> Head 50 with 5% threshold -> FAIL without division by zero
      const zeroBase = enforceThresholds(
        createBenchmarkDiff("cpu_instructions", 0, 50, aggregateConfig),
        aggregateConfig,
      );
      expect(zeroBase).toHaveLength(1);
      expect(zeroBase[0]).toMatchObject({
        aggregate_id: "flow-cpu",
        metric: "cpu_instructions",
        delta: 50,
        pct: null,
        rule: "allow_5_percent_increase",
      });
      expect(zeroBase[0].message).toContain("Infinity%");

      // Base 100 -> Head 80 (improvement) with 5% threshold -> PASS
      expect(
        enforceThresholds(
          createBenchmarkDiff("cpu_instructions", 100, 80, aggregateConfig),
          aggregateConfig,
        ),
      ).toEqual([]);
    });
  });
});
