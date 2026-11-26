const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const bin = path.resolve(repoRoot, require("../package.json").bin.weighin);

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-dry-run-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(cwd, ...args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10000,
  });
}

function writeSampleWorkspace(dir, options = {}) {
  const {
    toml = "[thresholds.global]\nfail_on_any_regression = false\n",
    fixtures = {
      contracts: [
        {
          id: "sample-contract",
          wasm_path: "artifacts/sample.wasm",
          invocations: [
            {
              function_name: "hello",
              args: [{ type: "Symbol", value: "world" }],
            },
          ],
        },
      ],
    },
    createWasm = true,
  } = options;

  if (toml !== null) {
    fs.writeFileSync(path.join(dir, "weighin.toml"), toml, "utf8");
  }
  if (fixtures !== null) {
    const content =
      typeof fixtures === "string"
        ? fixtures
        : JSON.stringify(fixtures, null, 2);
    fs.writeFileSync(path.join(dir, "weighin-fixtures.json"), content, "utf8");
  }
  if (createWasm) {
    fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "artifacts", "sample.wasm"),
      Buffer.from([0x00, 0x61, 0x73, 0x6d]),
    );
  }
}

test("CLI --dry-run succeeds on valid config, fixtures, and existing WASM files without RPC", (t) => {
  const cwd = makeTempDir(t);
  writeSampleWorkspace(cwd);

  const result = run(cwd, "--dry-run", "--rpc-url", "http://127.0.0.1:1/rpc");
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "✔ Configuration and fixtures are valid");
  assert.equal(result.stderr, "");
  assert.equal(fs.existsSync(path.join(cwd, "weighin-results.json")), false);
});

test("CLI --dry-run succeeds with a custom fixtures path and without weighin.toml", (t) => {
  const cwd = makeTempDir(t);
  writeSampleWorkspace(cwd, { toml: null, fixtures: null, createWasm: true });
  const customFixturesPath = path.join(cwd, "custom-fixtures.json");
  fs.writeFileSync(
    customFixturesPath,
    JSON.stringify({
      contracts: [
        {
          wasm_path: "artifacts/sample.wasm",
          invocations: [{ function_name: "ping", args: [] }],
        },
      ],
    }),
    "utf8",
  );

  const result = run(cwd, "--dry-run", "custom-fixtures.json");
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "✔ Configuration and fixtures are valid");
  assert.equal(result.stderr, "");
});

test("CLI --dry-run fails on invalid weighin.toml syntax", (t) => {
  const cwd = makeTempDir(t);
  writeSampleWorkspace(cwd, {
    toml: "[thresholds.global\nfail_on_any_regression = true\n",
  });

  const result = run(cwd, "--dry-run");
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Failed to parse TOML in weighin\.toml/);
  assert.equal(result.stdout, "");
});

test("CLI --dry-run fails on invalid weighin.toml schema", (t) => {
  const cwd = makeTempDir(t);
  writeSampleWorkspace(cwd, {
    toml: "[thresholds.global]\nunknown_option = true\n",
  });

  const result = run(cwd, "--dry-run");
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid WeighIn configuration in weighin\.toml/);
  assert.equal(result.stdout, "");
});

test("CLI --dry-run fails on invalid fixtures JSON or schema", (t) => {
  const cwd = makeTempDir(t);
  writeSampleWorkspace(cwd, {
    fixtures: {
      contracts: [],
    },
  });

  const result = run(cwd, "--dry-run");
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid WeighIn configuration/);
  assert.equal(result.stdout, "");
});

test("CLI --dry-run fails when referenced WASM file does not exist", (t) => {
  const cwd = makeTempDir(t);
  writeSampleWorkspace(cwd, { createWasm: false });

  const result = run(cwd, "--dry-run");
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Missing WASM file\(s\): artifacts\/sample\.wasm/,
  );
  assert.equal(result.stdout, "");
});

test("CLI --dry-run fails when fixtures file does not exist", (t) => {
  const cwd = makeTempDir(t);
  writeSampleWorkspace(cwd, { fixtures: null });

  const result = run(cwd, "--dry-run");
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Fixtures file not found: weighin-fixtures\.json/,
  );
  assert.equal(result.stdout, "");
});
