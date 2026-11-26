import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = path.resolve(__dirname, "..");
const script = path.join(root, "scripts", "validate-fixtures.js");

function run(fixturePath: string) {
  return spawnSync(process.execPath, [script, fixturePath], {
    cwd: root,
    encoding: "utf8",
  });
}

function withTempFixture(content: string, fn: (file: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-validate-"));
  const file = path.join(dir, "fixture.json");
  fs.writeFileSync(file, content);
  try {
    fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("scripts/validate-fixtures.js", () => {
  it("exits 0 for a valid fixture file", () => {
    const result = run(
      path.join(
        root,
        "tests/fixtures/source-account/source-account-fixtures.json",
      ),
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Valid fixture");
  });

  it("exits 1 with field path errors for an invalid fixture", () => {
    const invalid = {
      contracts: [
        {
          wasm_path: 42,
          invocations: [
            { function_name: "", args: [{ type: "bogus", value: "x" }] },
          ],
        },
      ],
      unexpected: true,
    };
    withTempFixture(JSON.stringify(invalid), (file) => {
      const result = run(file);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("contracts.0.wasm_path");
      expect(result.stderr).toContain(
        "contracts.0.invocations.0.function_name",
      );
      expect(result.stderr).toContain("contracts.0.invocations.0.args.0.type");
      expect(result.stderr).toContain("unexpected");
    });
  });

  it("exits 1 with a clear error for malformed JSON", () => {
    withTempFixture("{ not json", (file) => {
      const result = run(file);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Invalid JSON");
    });
  });

  it("exits 1 when no fixture path is provided", () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expected exactly one fixture file path");
  });
});
