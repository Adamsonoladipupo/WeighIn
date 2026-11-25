import { describe, it, expect } from "vitest";
import { FixturesSpecSchema } from "../src/config";
import { parseFixtures } from "../src/identity";

function fixtureWithInvocation(invocation: Record<string, unknown>) {
  return {
    contracts: [{ wasm_path: "contract.wasm", invocations: [invocation] }],
  };
}

describe("fixture invocations without an args array", () => {
  it("defaults a missing args property to an empty list", () => {
    const result = FixturesSpecSchema.safeParse(
      fixtureWithInvocation({ function_name: "get_status" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contracts[0].invocations[0]).toEqual({
        function_name: "get_status",
        args: [],
      });
    }
  });

  it("parses weighin-fixtures.json content and treats args as []", () => {
    const raw = JSON.stringify(
      fixtureWithInvocation({ function_name: "get_status" }),
    );
    const parsed = parseFixtures(raw, "weighin-fixtures.json");
    const [invocation] = parsed.contracts[0].invocations;
    expect(invocation.function_name).toBe("get_status");
    expect(invocation.args).toEqual([]);
    expect(invocation.case_id).toBe("args:[]");
  });

  it("gives an omitted args array the same identity as an explicit empty one", () => {
    const omitted = parseFixtures(
      JSON.stringify(fixtureWithInvocation({ function_name: "get_status" })),
      "weighin-fixtures.json",
    );
    const explicit = parseFixtures(
      JSON.stringify(
        fixtureWithInvocation({ function_name: "get_status", args: [] }),
      ),
      "weighin-fixtures.json",
    );
    expect(omitted).toEqual(explicit);
  });

  it("still rejects an args value that is present but not an array", () => {
    expect(() =>
      parseFixtures(
        JSON.stringify(
          fixtureWithInvocation({ function_name: "get_status", args: null }),
        ),
        "weighin-fixtures.json",
      ),
    ).toThrow(/contracts\.0\.invocations\.0\.args/);
  });
});

describe("malformed fixtures produce structured Zod errors", () => {
  it("reports the field path when wasm_path is missing", () => {
    const result = FixturesSpecSchema.safeParse({
      contracts: [{ invocations: [{ function_name: "get_status" }] }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "contracts.0.wasm_path",
      );
      expect(issue).toBeDefined();
      expect(issue?.code).toBe("invalid_type");
      expect((issue as { expected?: string }).expected).toBe("string");
    }
  });

  it("reports the field path when function_name is missing", () => {
    const result = FixturesSpecSchema.safeParse(
      fixtureWithInvocation({ args: [] }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "contracts.0.invocations.0.function_name",
      );
      expect(issue).toBeDefined();
      expect(issue?.code).toBe("invalid_type");
      expect((issue as { expected?: string }).expected).toBe("string");
    }
  });

  it("throws with the field path when parseFixtures sees a missing function_name", () => {
    const raw = JSON.stringify(fixtureWithInvocation({ args: [] }));
    expect(() => parseFixtures(raw, "weighin-fixtures.json")).toThrow(
      /contracts\.0\.invocations\.0\.function_name/,
    );
  });

  it("rejects an unsupported argument type and reports its path", () => {
    const result = FixturesSpecSchema.safeParse(
      fixtureWithInvocation({
        function_name: "set_value",
        args: [{ type: "UnknownType", value: 1 }],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.startsWith("contracts.0.invocations.0.args.0"))).toBe(
        true,
      );
    }
  });

  it("throws with the field path for an unsupported argument type via parseFixtures", () => {
    const raw = JSON.stringify(
      fixtureWithInvocation({
        function_name: "set_value",
        args: [{ type: "UnknownType", value: 1 }],
      }),
    );
    expect(() => parseFixtures(raw, "weighin-fixtures.json")).toThrow(
      /contracts\.0\.invocations\.0\.args\.0/,
    );
  });

  it("rejects an empty contracts array with a path-specific issue", () => {
    const result = FixturesSpecSchema.safeParse({ contracts: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "contracts");
      expect(issue).toBeDefined();
      expect(issue?.code).toBe("too_small");
    }
  });

  it("throws with the contracts path when parseFixtures receives an empty contracts array", () => {
    const raw = JSON.stringify({ contracts: [] });
    expect(() => parseFixtures(raw, "weighin-fixtures.json")).toThrow(/contracts/);
  });
});
