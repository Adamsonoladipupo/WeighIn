const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const CLI = path.resolve(__dirname, "..", "dist", "cli.js");

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

test("--json writes only a parseable JSON document to stdout", () => {
  const result = run(["--json"]);
  assert.equal(result.status, 0, `CLI exited non-zero: ${result.stderr}`);

  let parsed;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(result.stdout);
  }, `stdout is not pure JSON:\n${result.stdout}`);

  assert.equal(typeof parsed, "object");
  assert.notEqual(parsed, null);
});

test("--json output contains no human-readable banner text", () => {
  const result = run(["--json"]);
  assert.equal(result.status, 0, `CLI exited non-zero: ${result.stderr}`);
  const trimmed = result.stdout.trim();
  assert.ok(
    trimmed.startsWith("{") || trimmed.startsWith("["),
    `stdout does not begin with JSON:\n${trimmed}`,
  );
});

test("--json keeps diagnostics off stdout", () => {
  const result = run(["--json"]);
  assert.equal(result.status, 0, `CLI exited non-zero: ${result.stderr}`);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
});
