import { describe, it, expect, vi } from "vitest";
import { loadConfig, enforceThresholds } from "../src/threshold";
import { diffBenchmarks } from "../src/diff";
import {
  WeighinConfigSchema,
  FixturesSpecSchema,
  formatZodError,
} from "../src/config";
import * as fs from "fs";

vi.mock("fs");

function createCompleteMetrics(consumed: number, limit = 1000) {
  return {
    cpu_instructions: { consumed, limit },
    memory_bytes: { consumed, limit },
    ledger_read_entries: { consumed, limit },
    ledger_read_bytes: { consumed, limit },
    ledger_write_entries: { consumed, limit },
    ledger_write_bytes: { consumed, limit },
    historical_data_read_bytes: { consumed, limit },
    contract_data_hard_limit: { consumed, limit },
    tx_size_bytes: { consumed, limit },
    events_count: { consumed, limit },
    event_data_bytes: { consumed, limit },
  };
}

describe("loadConfig (TOML parsing & Zod Validation)", () => {
  it("returns null if file does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(loadConfig("missing.toml")).toBeNull();
  });

  it("parses a valid minimal weighin.toml", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
      [thresholds.global]
      fail_on_any_regression = true
    `);
    const config = loadConfig("weighin.toml");
    expect(config?.thresholds?.global?.fail_on_any_regression).toBe(true);
  });

  it("parses a full valid weighin.toml with dynamic function names", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
      [thresholds.global]
      fail_on_any_regression = false
      max_allowed_cpu_increase_pct = 5

      [thresholds.functions.hello_world]
      memory_bytes = "ignore"
      cpu_instructions = "strict_zero_tolerance"
      
      [thresholds.functions.another_fn]
      events_count = "allow_10_percent_increase"
    `);
    const config = loadConfig("weighin.toml");
    expect(config?.thresholds?.functions?.hello_world?.memory_bytes).toBe(
      "ignore",
    );
    expect(config?.thresholds?.functions?.another_fn?.events_count).toBe(
      "allow_10_percent_increase",
    );
  });

  it("throws on malformed toml", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
      [thresholds.global
      missing_bracket = true
    `);
    expect(() => loadConfig("weighin.toml")).toThrow("Failed to parse TOML");
  });

  it("throws on unknown top-level property (strict)", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
      unknown_key = true
    `);
    expect(() => loadConfig("weighin.toml")).toThrow(/unknown_key/);
  });

  it("throws on unknown rule string", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
      [thresholds.functions.test]
      memory_bytes = "allow_magic"
    `);
    expect(() => loadConfig("weighin.toml")).toThrow(
      "Unsupported threshold rule",
    );
  });

  it("throws on invalid metric key", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
      [thresholds.functions.test]
      memory_byte = "ignore"
    `);
    expect(() => loadConfig("weighin.toml")).toThrow(/memory_byte/);
  });

  it("parses valid absolute limits", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
      [limits.global]
      tx_size_bytes = 100000
      [limits.functions.hello_world]
      cpu_instructions = 50000000
    `);
    const config = loadConfig("weighin.toml");
    expect(config?.limits?.global?.tx_size_bytes).toBe(100000);
    expect(config?.limits?.functions?.hello_world?.cpu_instructions).toBe(
      50000000,
    );
  });

  it("throws on negative limit values", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
      [limits.global]
      tx_size_bytes = -1
    `);
    expect(() => loadConfig("weighin.toml")).toThrow(/>=\s?0/);
  });

  describe("weighin.toml threshold parsing with edge cases (#315)", () => {
    it("parses empty config file and defaults to permissive mode without violations", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("");

      const config = loadConfig("weighin.toml");
      expect(
        config,
        "empty file should parse to an empty configuration object",
      ).toEqual({});

      // Permissive mode verification: enforceThresholds with empty config yields 0 violations
      const base = [
        {
          contract_id: "test-contract",
          git_commit: "base",
          soroban_sdk_version: "1.0",
          timestamp: 0,
          benchmarks: [
            {
              function_name: "test-fn",
              wasm_sha256: "w1",
              metrics: createCompleteMetrics(100),
            },
          ],
        },
      ];
      const head = [
        {
          contract_id: "test-contract",
          git_commit: "head",
          soroban_sdk_version: "1.0",
          timestamp: 1,
          benchmarks: [
            {
              function_name: "test-fn",
              wasm_sha256: "w1",
              metrics: createCompleteMetrics(150),
            },
          ],
        },
      ];
      const diff = diffBenchmarks(base, head);
      const violations = enforceThresholds(diff, config!);
      expect(
        violations,
        "permissive empty config must not flag regressions as violations",
      ).toEqual([]);
    });

    it("throws descriptive errors on invalid percentage strings", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Raw percentage string like 'abc%' or '50%'
      vi.mocked(fs.readFileSync).mockReturnValue(`
        [thresholds.functions.transfer]
        cpu_instructions = "abc%"
      `);
      expect(
        () => loadConfig("weighin.toml"),
        "invalid rule string 'abc%' must be rejected with descriptive message",
      ).toThrow(/Unsupported threshold rule/);

      // Malformed allow percentage string
      vi.mocked(fs.readFileSync).mockReturnValue(`
        [thresholds.functions.transfer]
        cpu_instructions = "allow_abc_percent_increase"
      `);
      expect(
        () => loadConfig("weighin.toml"),
        "malformed rule string 'allow_abc_percent_increase' must throw descriptive error",
      ).toThrow(/Unsupported threshold rule/);

      // Invalid standalone percent
      vi.mocked(fs.readFileSync).mockReturnValue(`
        [thresholds.global]
        max_allowed_cpu_increase_pct = "invalid_pct"
      `);
      expect(
        () => loadConfig("weighin.toml"),
        "string in numeric percentage field must throw type error",
      ).toThrow(/expected number|Invalid WeighIn configuration/i);
    });

    it("rejects negative values in absolute thresholds and limits", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Negative global absolute limit
      vi.mocked(fs.readFileSync).mockReturnValue(`
        [limits.global]
        cpu_instructions = -500
      `);
      expect(
        () => loadConfig("weighin.toml"),
        "negative global limit must be rejected",
      ).toThrow(/>=\s?0|Too small/);

      // Negative per-function limit
      vi.mocked(fs.readFileSync).mockReturnValue(`
        [limits.functions.deposit]
        memory_bytes = -10
      `);
      expect(
        () => loadConfig("weighin.toml"),
        "negative per-function limit must be rejected",
      ).toThrow(/>=\s?0|Too small/);

      // Negative percentage threshold in global
      vi.mocked(fs.readFileSync).mockReturnValue(`
        [thresholds.global]
        max_allowed_cpu_increase_pct = -5
      `);
      expect(
        () => loadConfig("weighin.toml"),
        "negative max_allowed_cpu_increase_pct must be rejected",
      ).toThrow(/>=\s?0|Too small/);
    });

    it("triggers validation errors on unknown top-level sections", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      vi.mocked(fs.readFileSync).mockReturnValue(`
        [custom_section]
        enabled = true
      `);
      expect(
        () => loadConfig("weighin.toml"),
        "unknown section [custom_section] must trigger strict validation error",
      ).toThrow(/custom_section/);

      vi.mocked(fs.readFileSync).mockReturnValue(`
        [settings]
        retries = 3
      `);
      expect(
        () => loadConfig("weighin.toml"),
        "unknown section [settings] must trigger strict validation error",
      ).toThrow(/settings/);
    });
  });
});

describe("FixturesSpecSchema", () => {
  it("parses a valid fixture", () => {
    const valid = {
      contracts: [
        {
          wasm_path: "foo.wasm",
          invocations: [
            {
              function_name: "test",
              args: [{ type: "u32", value: 42 }],
            },
          ],
        },
      ],
    };
    expect(FixturesSpecSchema.safeParse(valid).success).toBe(true);
  });

  it("fails on missing required fields", () => {
    const invalid = { contracts: [{ wasm_path: "foo.wasm" }] };
    const res = FixturesSpecSchema.safeParse(invalid);
    expect(res.success).toBe(false);
    if (!res.success) {
      const msg = formatZodError(res.error, "fixtures.json");
      expect(msg).toContain("contracts.0.invocations");
      expect(msg).toMatch(/expected array|Required/);
    }
  });

  it("fails on invalid argument type", () => {
    const invalid = {
      contracts: [
        {
          wasm_path: "foo.wasm",
          invocations: [
            {
              function_name: "test",
              args: [{ type: "magic", value: 42 }],
            },
          ],
        },
      ],
    };
    const res = FixturesSpecSchema.safeParse(invalid);
    expect(res.success).toBe(false);
    if (!res.success) {
      const msg = formatZodError(res.error, "fix.json");
      expect(msg).toContain("Invalid option");

      // Error formatting test (newline fix)
      const lines = msg.split("\n");
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe("Invalid WeighIn configuration in fix.json:");
      expect(lines[1]).toContain(
        "- contracts.0.invocations.0.args.0.type: Invalid option",
      );
    }
  });

  it("parses mixed-case types correctly and round-trips to lowercase", () => {
    const input = {
      contracts: [
        {
          wasm_path: "foo.wasm",
          invocations: [
            {
              function_name: "test",
              args: [
                { type: "SymBol", value: "hello" },
                { type: "VEC", value: [{ type: "U32", value: 123 }] },
                {
                  type: "Map",
                  value: [
                    {
                      key: { type: "STRING", value: "k" },
                      value: { type: "I64", value: "10" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const res = FixturesSpecSchema.safeParse(input);
    expect(res.success).toBe(true);
    if (res.success) {
      const args = res.data.contracts[0].invocations[0].args;
      expect(args[0].type).toBe("symbol");
      expect(args[1].type).toBe("vec");
      expect(args[1].value[0].type).toBe("u32");
      expect(args[2].type).toBe("map");
      expect(args[2].value[0].key.type).toBe("string");
      expect(args[2].value[0].value.type).toBe("i64");
    }
  });

  it("accepts valid optional ID-bearing fixtures at fixture, contract, and invocation level", () => {
    const input = {
      id: "fixture-main",
      contracts: [
        {
          id: "contract-1",
          wasm_path: "test.wasm",
          invocations: [
            {
              id: "inv-1",
              function_name: "test_fn",
              args: [{ type: "U32", value: 42 }],
            },
          ],
        },
      ],
    };
    const res = FixturesSpecSchema.safeParse(input);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.id).toBe("fixture-main");
      expect(res.data.contracts[0].id).toBe("contract-1");
      expect(res.data.contracts[0].invocations[0].id).toBe("inv-1");
    }
  });

  it("rejects blank IDs at fixture, contract, and invocation level", () => {
    expect(
      FixturesSpecSchema.safeParse({
        id: "   ",
        contracts: [
          {
            wasm_path: "test.wasm",
            invocations: [{ function_name: "test_fn", args: [] }],
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      FixturesSpecSchema.safeParse({
        contracts: [
          {
            id: "",
            wasm_path: "test.wasm",
            invocations: [{ function_name: "test_fn", args: [] }],
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      FixturesSpecSchema.safeParse({
        contracts: [
          {
            wasm_path: "test.wasm",
            invocations: [{ id: "  ", function_name: "test_fn", args: [] }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
