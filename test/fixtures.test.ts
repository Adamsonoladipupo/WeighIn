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
