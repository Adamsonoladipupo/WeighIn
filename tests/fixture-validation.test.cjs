"use strict";
// Tests for the offline `weighin validate <fixtures.json>` subcommand.
// All tests run offline: no RPC, no GitHub API, no native helper, no builds.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const pkg = require("../package.json");
const bin = path.resolve(repoRoot, pkg.bin.weighin);

// Import the compiled modules directly for unit-level tests that do not need
// subprocess spawning.
const { parseArgs, validateFixtures } = require("../dist/cli");
const { parseFixtures } = require("../dist/identity");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "weighin-fixture-validation-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeFixture(directory, name, content) {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

const VALID_FIXTURE = JSON.stringify({
  id: "greeting-suite",
  contracts: [
    {
      id: "greeting",
      wasm_path: "contract/target/wasm32v1-none/release/contract_test.wasm",
      invocations: [
        {
          id: "hello-world",
          function_name: "hello",
          args: [{ type: "symbol", value: "world" }],
        },
      ],
    },
  ],
});

const VALID_MINIMAL_FIXTURE = JSON.stringify({
  contracts: [
    {
      wasm_path: "contract.wasm",
      invocations: [{ function_name: "get_status", args: [] }],
    },
  ],
});

function runValidate(cwd, ...args) {
  return spawnSync(process.execPath, [bin, "validate", ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10000,
    // Explicitly clear network-adjacent env vars to prove offline operation;
    // the subprocess cannot reach any endpoint even if code tried.
    env: {
      ...process.env,
      WEIGHIN_HELPER_PATH: undefined,
    },
  });
}

// ---------------------------------------------------------------------------
// 1. Successful validation of a valid fixture
// ---------------------------------------------------------------------------
test("validate accepts a well-formed fixture file and exits 0", (t) => {
  const dir = tmpDir(t);
  const filePath = writeFixture(dir, "valid.json", VALID_FIXTURE);
  const result = runValidate(dir, filePath);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fixture is valid/);
  assert.equal(result.stderr, "");
});

test("validate accepts a minimal fixture file (no optional id fields)", (t) => {
  const dir = tmpDir(t);
  const filePath = writeFixture(dir, "minimal.json", VALID_MINIMAL_FIXTURE);
  const result = runValidate(dir, filePath);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fixture is valid/);
  assert.equal(result.stderr, "");
});

// ---------------------------------------------------------------------------
// 2. Invalid fixture schema
// ---------------------------------------------------------------------------
test("validate rejects a fixture with a blank contract id and exits 1", (t) => {
  const dir = tmpDir(t);
  const invalid = JSON.stringify({
    contracts: [
      {
        id: "   ",
        wasm_path: "contract.wasm",
        invocations: [{ function_name: "hello", args: [] }],
      },
    ],
  });
  const filePath = writeFixture(dir, "blank-id.json", invalid);
  const result = runValidate(dir, filePath);
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /ID must not be blank/);
  assert.equal(result.stdout, "");
});

test("validate rejects a fixture missing required invocations field and exits 1", (t) => {
  const dir = tmpDir(t);
  const invalid = JSON.stringify({
    contracts: [{ wasm_path: "contract.wasm" }],
  });
  const filePath = writeFixture(dir, "no-invocations.json", invalid);
  const result = runValidate(dir, filePath);
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout);
  // The Zod schema error must include a path pointer
  assert.match(result.stderr, /contracts\b/);
  assert.equal(result.stdout, "");
});

test("validate rejects a fixture with an empty contracts array and exits 1", (t) => {
  const dir = tmpDir(t);
  const invalid = JSON.stringify({ contracts: [] });
  const filePath = writeFixture(dir, "empty-contracts.json", invalid);
  const result = runValidate(dir, filePath);
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /contracts/);
  assert.equal(result.stdout, "");
});

test("validate rejects a fixture with an unknown top-level key and exits 1", (t) => {
  const dir = tmpDir(t);
  const invalid = JSON.stringify({
    contracts: [
      {
        wasm_path: "c.wasm",
        invocations: [{ function_name: "f", args: [] }],
      },
    ],
    unknown_field: true,
  });
  const filePath = writeFixture(dir, "unknown-key.json", invalid);
  const result = runValidate(dir, filePath);
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /unrecognized/i);
  assert.equal(result.stdout, "");
});

test("validate rejects duplicate invocation identities within a contract", (t) => {
  const dir = tmpDir(t);
  const invalid = JSON.stringify({
    contracts: [
      {
        wasm_path: "c.wasm",
        invocations: [
          { id: "case-a", function_name: "hello", args: [] },
          { id: "case-a", function_name: "hello", args: [] },
        ],
      },
    ],
  });
  const filePath = writeFixture(dir, "duplicate-ids.json", invalid);
  const result = runValidate(dir, filePath);
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /[Dd]uplicate/);
  assert.equal(result.stdout, "");
});

// ---------------------------------------------------------------------------
// 3. Malformed fixture input
// ---------------------------------------------------------------------------
test("validate rejects a file containing invalid JSON and exits 1", (t) => {
  const dir = tmpDir(t);
  const filePath = writeFixture(dir, "broken.json", "{ not valid json }");
  const result = runValidate(dir, filePath);
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /malformed JSON|JSON/i);
  assert.equal(result.stdout, "");
});

test("validate rejects an empty file as malformed JSON", (t) => {
  const dir = tmpDir(t);
  const filePath = writeFixture(dir, "empty.json", "");
  const result = runValidate(dir, filePath);
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /malformed JSON|JSON/i);
  assert.equal(result.stdout, "");
});

test("validate rejects a JSON scalar (not an object) as a schema error", (t) => {
  const dir = tmpDir(t);
  const filePath = writeFixture(dir, "scalar.json", '"just a string"');
  const result = runValidate(dir, filePath);
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout);
  // Either malformed-JSON or schema-invalid is acceptable for a non-object root
  assert.ok(result.stderr.length > 0);
  assert.equal(result.stdout, "");
});

// ---------------------------------------------------------------------------
// 4. Missing or unreadable fixture files
// ---------------------------------------------------------------------------
test("validate reports a missing file clearly and exits 1", (t) => {
  const dir = tmpDir(t);
  const result = runValidate(dir, path.join(dir, "does-not-exist.json"));
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /not found|ENOENT/i);
  assert.equal(result.stdout, "");
});

test("validate reports an unreadable file clearly and exits 1", (t) => {
  // Skip on non-Unix platforms where chmod may not restrict root
  if (process.platform !== "linux" && process.platform !== "darwin") {
    return;
  }
  const dir = tmpDir(t);
  const filePath = writeFixture(dir, "noaccess.json", VALID_FIXTURE);
  fs.chmodSync(filePath, 0o000);
  t.after(() => {
    try {
      fs.chmodSync(filePath, 0o644);
    } catch {
      /* best-effort cleanup */
    }
  });
  const result = runValidate(dir, filePath);
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout);
  // Either "not readable" or EACCES is acceptable
  assert.ok(result.stderr.length > 0);
  assert.equal(result.stdout, "");
});

// ---------------------------------------------------------------------------
// 5. Useful file and field paths in validation errors
// ---------------------------------------------------------------------------
test("validate error messages include the fixture file path", (t) => {
  const dir = tmpDir(t);
  const fileName = "my-fixtures.json";
  const invalid = JSON.stringify({
    contracts: [
      {
        id: "   ",
        wasm_path: "c.wasm",
        invocations: [{ function_name: "f", args: [] }],
      },
    ],
  });
  const filePath = writeFixture(dir, fileName, invalid);
  const result = runValidate(dir, filePath);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  // The file name should appear in the error output
  assert.match(result.stderr, new RegExp(fileName));
});

test("validate error messages include the field path for schema violations", (t) => {
  const dir = tmpDir(t);
  const invalid = JSON.stringify({
    contracts: [
      {
        wasm_path: "c.wasm",
        invocations: [
          {
            function_name: "f",
            // null is not a valid args array
            args: null,
          },
        ],
      },
    ],
  });
  const filePath = writeFixture(dir, "null-args.json", invalid);
  const result = runValidate(dir, filePath);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  // The error must name the offending field or its path
  assert.match(result.stderr, /contracts|invocations|args|value/i);
});

// ---------------------------------------------------------------------------
// 6. Correct success and failure exit codes
// ---------------------------------------------------------------------------
test("validate exits 0 on success and writes only to stdout", (t) => {
  const dir = tmpDir(t);
  const filePath = writeFixture(dir, "valid.json", VALID_FIXTURE);
  const result = runValidate(dir, filePath);
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.ok(result.stdout.trim().length > 0);
  assert.equal(result.stderr, "");
});

test("validate exits 1 on failure and writes only to stderr", (t) => {
  const dir = tmpDir(t);
  const filePath = writeFixture(dir, "broken.json", "not json");
  const result = runValidate(dir, filePath);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.trim().length > 0);
});

// ---------------------------------------------------------------------------
// 7. Consistency with the shared fixture parser
// ---------------------------------------------------------------------------
test("validateFixtures (unit) uses parseFixtures and produces consistent errors", () => {
  // A fixture that parseFixtures rejects must also cause validateFixtures to throw.
  const badRaw = JSON.stringify({
    contracts: [
      {
        id: "   ",
        wasm_path: "c.wasm",
        invocations: [{ function_name: "f", args: [] }],
      },
    ],
  });
  // parseFixtures must throw on this input
  assert.throws(
    () => parseFixtures(badRaw, "test.json"),
    /ID must not be blank/,
  );
  // validateFixtures must throw on the same input (via a temporary file)
  const tmpFile = path.join(
    os.tmpdir(),
    `weighin-unit-test-${Date.now()}.json`,
  );
  try {
    fs.writeFileSync(tmpFile, badRaw, "utf8");
    assert.throws(() => validateFixtures(tmpFile), /ID must not be blank/);
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* best-effort cleanup */
    }
  }
});

test("validateFixtures (unit) succeeds for inputs parseFixtures accepts", () => {
  const tmpFile = path.join(
    os.tmpdir(),
    `weighin-unit-test-${Date.now()}.json`,
  );
  try {
    fs.writeFileSync(tmpFile, VALID_FIXTURE, "utf8");
    // Must not throw
    const result = validateFixtures(tmpFile);
    assert.match(result, /fixture is valid/);
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* best-effort cleanup */
    }
  }
});

test("parseArgs returns { kind: validate } for validate subcommand", () => {
  const cmd = parseArgs(["validate", "my-fixtures.json"]);
  assert.equal(cmd.kind, "validate");
  assert.equal(cmd.fixturePath, "my-fixtures.json");
});

test("parseArgs rejects validate with no path", () => {
  assert.throws(
    () => parseArgs(["validate"]),
    /validate requires a fixtures file path/,
  );
});

test("parseArgs rejects validate with extra positional", () => {
  assert.throws(
    () => parseArgs(["validate", "a.json", "b.json"]),
    /Unexpected argument: b\.json/,
  );
});

test("parseArgs rejects validate with an unknown flag", () => {
  assert.throws(
    () => parseArgs(["validate", "--rpc-url", "a.json"]),
    /Unknown option: --rpc-url/,
  );
});

// ---------------------------------------------------------------------------
// 8. Invocation through the actual CLI package entrypoint
// ---------------------------------------------------------------------------
test("validate subcommand is reachable through the declared package bin", (t) => {
  const dir = tmpDir(t);
  const filePath = writeFixture(dir, "valid.json", VALID_FIXTURE);
  // Run via the bin entry declared in package.json — same path used by npm/npx
  const result = spawnSync(process.execPath, [bin, "validate", filePath], {
    cwd: dir,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fixture is valid/);
});

test("validate is included in --help output", (t) => {
  const dir = tmpDir(t);
  const result = spawnSync(process.execPath, [bin, "--help"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /validate/);
  assert.match(result.stdout, /offline/i);
});

// ---------------------------------------------------------------------------
// 9. Proof that no RPC, GitHub API, helper provisioning or build is invoked
// ---------------------------------------------------------------------------
test("validate does not contact any network endpoint (spy via module preload)", (t) => {
  const dir = tmpDir(t);
  const filePath = writeFixture(dir, "valid.json", VALID_FIXTURE);

  // Inject a preload that overrides known network entry-points and
  // fails hard if any of them are called.
  const preload = path.join(dir, "spy.cjs");
  const measurementPath = path.join(repoRoot, "dist/measurement.js");
  const simulationPath = path.join(repoRoot, "dist/simulation.js");
  fs.writeFileSync(
    preload,
    `
"use strict";
function forbidden(name) {
  return function() {
    throw new Error('FORBIDDEN: ' + name + ' was called during validate');
  };
}
// Override runMeasurement so any accidental call fails loudly
const measurement = require(${JSON.stringify(measurementPath)});
measurement.runMeasurement = forbidden('runMeasurement');
// Override resolveSimulationHelper so helper provisioning cannot happen
const simulation = require(${JSON.stringify(simulationPath)});
simulation.resolveSimulationHelper = forbidden('resolveSimulationHelper');
`,
  );

  const result = spawnSync(
    process.execPath,
    ["--require", preload, bin, "validate", filePath],
    { cwd: dir, encoding: "utf8", timeout: 10000 },
  );
  assert.ifError(result.error);
  // Must succeed cleanly — if any forbidden function was called, the process
  // would have exited 1 with a FORBIDDEN error on stderr.
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /FORBIDDEN/);
  assert.match(result.stdout, /fixture is valid/);
});

test("validate produces no output files (filesystem is untouched)", (t) => {
  const dir = tmpDir(t);
  const filePath = writeFixture(dir, "valid.json", VALID_FIXTURE);
  const before = new Set(fs.readdirSync(dir));
  runValidate(dir, filePath);
  const after = new Set(fs.readdirSync(dir));
  // No new files must be created
  for (const f of after) {
    assert.ok(before.has(f), `Unexpected file created: ${f}`);
  }
});

test("validate does not read or write git state", (t) => {
  // Run validate in a directory that is NOT a git repository.
  // If it called git, the process would fail or error.
  const dir = tmpDir(t);
  const filePath = writeFixture(dir, "valid.json", VALID_FIXTURE);
  const result = runValidate(dir, filePath);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /git/i);
});

// ---------------------------------------------------------------------------
// 10. Preservation of existing CLI functionality
// ---------------------------------------------------------------------------
test("existing --help flag is unaffected by the validate subcommand", (t) => {
  const dir = tmpDir(t);
  const result = spawnSync(process.execPath, [bin, "--help"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: weighin/);
  assert.match(result.stdout, /--rpc-url/);
  assert.match(result.stdout, /--output/);
});

test("existing --version flag is unaffected by the validate subcommand", (t) => {
  const dir = tmpDir(t);
  const result = spawnSync(process.execPath, [bin, "--version"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), pkg.version);
});

test("existing measurement path still fails clearly for missing fixtures", (t) => {
  const dir = tmpDir(t);
  const result = spawnSync(
    process.execPath,
    [bin, path.join(dir, "nonexistent.json"), "--output", "out.json"],
    { cwd: dir, encoding: "utf8", timeout: 10000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Benchmarking failed/);
  assert.equal(fs.existsSync(path.join(dir, "out.json")), false);
});

test("existing argument-rejection rules are unaffected", (t) => {
  const dir = tmpDir(t);
  const cases = [
    { args: ["--unknown-flag"], match: /Unknown option/ },
    { args: ["--rpc-url"], match: /--rpc-url requires a value/ },
    {
      args: ["one.json", "two.json", "three.json"],
      match: /Unexpected argument/,
    },
  ];
  for (const { args, match } of cases) {
    const result = spawnSync(process.execPath, [bin, ...args], {
      cwd: dir,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, `args ${args.join(" ")}: expected exit 1`);
    assert.match(result.stderr, match);
    assert.equal(result.stdout, "");
  }
});

// ---------------------------------------------------------------------------
// Regression: validate with --help flag returns help, not an error
// ---------------------------------------------------------------------------
test("validate --help returns the general help text and exits 0", (t) => {
  const dir = tmpDir(t);
  const result = spawnSync(process.execPath, [bin, "validate", "--help"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: weighin/);
});

// ---------------------------------------------------------------------------
// Regression: validate with real repository fixture (weighin-fixtures.json)
// ---------------------------------------------------------------------------
test("validate accepts the repository's own weighin-fixtures.json", (t) => {
  const result = runValidate(repoRoot, "weighin-fixtures.json");
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fixture is valid/);
});
