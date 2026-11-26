import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli";

describe("parseArgs local comparison mode", () => {
  it("accepts BASE fixtures alongside HEAD fixtures and an output path", () => {
    const command = parseArgs([
      "--base-fixtures",
      "./base-fixtures.json",
      "./head-fixtures.json",
      "./results.json",
    ]);

    expect(command.kind).toBe("measure");
    if (command.kind !== "measure") return;

    expect(command.options).toMatchObject({
      fixturesPath: "./head-fixtures.json",
      baseFixturesPath: "./base-fixtures.json",
      outputPath: "./results.json",
      jsonStdout: false,
    });
  });

  it("rejects duplicate BASE fixture options", () => {
    expect(() =>
      parseArgs([
        "--base-fixtures",
        "base-one.json",
        "--base-fixtures",
        "base-two.json",
      ]),
    ).toThrow("Duplicate option: --base-fixtures");
  });

  it("rejects JSON stdout when BASE/HEAD comparison is enabled", () => {
    expect(() =>
      parseArgs(["--base-fixtures", "base.json", "--json-stdout"]),
    ).toThrow("Cannot use --json-stdout with base fixtures comparison");
  });
});
