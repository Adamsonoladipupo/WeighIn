// Explicit live standalone-network proof for committed fixture setup invocations.
// Excluded from npm test (requires a running pinned protocol-28 standalone
// Quickstart network and a built native weighin-simulation helper).
//
// Proves against the real standalone network and bundled initialized contract:
// 1. Deployment (upload + create) and ordered setup_invocations (`initialize(30)`,
//    `add(12)`) are prepared, signed, submitted, and confirmed SUCCESS before any
//    measured simulation runs.
// 2. Subsequent benchmark invocations (`read_value()`, `check_value(42)`) read
//    the committed persistent state `42` and pass RPC/native parity with zero
//    write entries and zero write bytes (proving setup consumption stays out of
//    benchmark metrics).
// 3. Control probe: simulating `read_value()` on a fresh deployment WITHOUT
//    setup_invocations fails with the contract's `not initialized` trap.
// 4. Failure probe: a rejecting setup call halts setup before measurement.
//
// Usage:
//   npm run build && npm run build:helper
//   node tests/experiments/verify-setup-invocations.cjs [destination-dir]
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const { createHash } = require("node:crypto");
const { Address, rpc, xdr } = require("@stellar/stellar-sdk");

const repository = path.resolve(__dirname, "../..");
const destination = path.resolve(
  process.argv[2] ||
    path.join(repository, "docs/experiments/setup-invocations"),
);
const temporary = fs.mkdtempSync(
  path.join(os.tmpdir(), "weighin-setup-invocations-"),
);
const endpoint =
  process.env.WEIGHIN_EXPERIMENT_RPC_URL || "http://localhost:8000/rpc";
const passphrase = "Standalone Network ; February 2017";
const helper =
  process.env.WEIGHIN_HELPER_PATH ||
  path.join(
    repository,
    "native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation",
  );
const fixtureDir = path.join(repository, "tests/fixtures/setup-invocations");
const wasmFile = path.join(
  fixtureDir,
  "target/wasm32v1-none/release/contract_test.wasm",
);
const fixturesFile = path.join(fixtureDir, "fixtures.json");

fs.mkdirSync(destination, { recursive: true });

const write = (name, data) =>
  fs.writeFileSync(
    path.join(destination, name),
    JSON.stringify(data, null, 2) + "\n",
  );
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const capture = (file, args) =>
  cp.execFileSync(file, args, { encoding: "utf8" }).trim();

let timeline = [];
let submissions = [];
const sendOriginal = rpc.Server.prototype.sendTransaction;
rpc.Server.prototype.sendTransaction = async function (transaction) {
  const response = await sendOriginal.call(this, transaction);
  const op = transaction.operations[0];
  const fn = op.func.switch().name;
  const entry = {
    hash: response.hash,
    status: response.status,
    host_function: fn,
  };
  if (fn === "hostFunctionTypeInvokeContract") {
    const invoke = op.func.invokeContract();
    entry.contract_id = Address.fromScAddress(
      invoke.contractAddress(),
    ).toString();
    entry.function_name = invoke.functionName().toString();
    entry.args_xdr = invoke.args().map((a) => a.toXDR("base64"));
  }
  submissions.push(entry);
  timeline.push(`submit:${entry.function_name ?? fn}`);
  return response;
};

let confirmations = [];
const getOriginal = rpc.Server.prototype.getTransaction;
rpc.Server.prototype.getTransaction = async function (hash) {
  const response = await getOriginal.call(this, hash);
  if (response.status !== "NOT_FOUND") {
    timeline.push(`confirmed:${response.status}`);
    confirmations.push({
      hash,
      status: response.status,
      ledger: response.ledger,
      return_xdr: response.returnValue
        ? response.returnValue.toXDR("base64")
        : null,
    });
  }
  return response;
};

let replays = [];
const execOriginal = cp.execFile;
cp.execFile = function (file, args, options, callback) {
  if (file !== helper) return execOriginal.apply(this, arguments);
  let input;
  const child = execOriginal(file, args, options, (error, stdout, stderr) => {
    const output = error ? null : JSON.parse(stdout);
    const invoke = xdr.HostFunction.fromXDR(
      input.host_function_xdr,
      "base64",
    ).invokeContract();
    timeline.push(`measure:${invoke.functionName().toString()}`);
    replays.push({
      contract_id: Address.fromScAddress(invoke.contractAddress()).toString(),
      function_name: invoke.functionName().toString(),
      read_only_keys: output?.read_only_keys ?? null,
      read_write_keys: output?.read_write_keys ?? null,
      retval_xdr: output?.retval_xdr ?? null,
      cpu_instructions_consumed: output?.cpu_instructions_consumed ?? null,
      memory_bytes_consumed: output?.memory_bytes_consumed ?? null,
      error: error ? String(stderr).trim() : null,
    });
    callback(error, stdout, stderr);
  });
  const end = child.stdin.end.bind(child.stdin);
  child.stdin.end = function (data, ...rest) {
    input = JSON.parse(data);
    return end(data, ...rest);
  };
  return child;
};

const { runMeasurement } = require("../../dist/measurement");

function reset() {
  timeline = [];
  submissions = [];
  confirmations = [];
  replays = [];
}

(async () => {
  const server = new rpc.Server(endpoint, { allowHttp: true });
  const network = await server.getNetwork();
  assert.equal(network.passphrase, passphrase);
  assert.equal(network.protocolVersion, 28);

  const wasmBytes = fs.readFileSync(wasmFile);
  const wasmSha = sha256(wasmBytes);

  write("environment.json", {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    rpc_url: endpoint,
    network_passphrase: network.passphrase,
    protocol_version: network.protocolVersion,
    helper_sha256: sha256(fs.readFileSync(helper)),
    wasm_sha256: wasmSha,
    repository_base: capture("git", ["-C", repository, "rev-parse", "HEAD"]),
  });

  // 1. Committed setup invocations + benchmark reads
  reset();
  const records = await runMeasurement({
    fixturesPath: fixturesFile,
    fixtureId: "tests/fixtures/setup-invocations/fixtures.json",
    keyFile: path.join(temporary, "success.key"),
    rpcUrl: endpoint,
    helperPath: helper,
    gitCommit: "setup-invocations-success",
    sdkVersion: "28.0.0",
  });
  const successTimeline = [...timeline];
  const successSubmissions = [...submissions];
  const successConfirmations = [...confirmations];
  const successReplays = [...replays];

  write("measurements.json", records);
  write("setup-receipts.json", {
    timeline: successTimeline,
    submissions: successSubmissions,
    confirmations: successConfirmations,
  });
  write("native-replays.json", successReplays);

  // 2. Negative control: omit setup_invocations -> read_value must fail
  reset();
  const uninitDir = path.join(temporary, "uninitialized");
  fs.mkdirSync(uninitDir);
  fs.copyFileSync(wasmFile, path.join(uninitDir, "initialized_contract.wasm"));
  fs.writeFileSync(
    path.join(uninitDir, "fixtures.json"),
    JSON.stringify({
      id: "uninitialized-control",
      contracts: [
        {
          id: "initialized-contract",
          wasm_path: "initialized_contract.wasm",
          invocations: [{ id: "read", function_name: "read_value", args: [] }],
        },
      ],
    }),
  );
  let uninitError = null;
  try {
    await runMeasurement({
      fixturesPath: path.join(uninitDir, "fixtures.json"),
      fixtureId: "uninitialized-control.json",
      keyFile: path.join(uninitDir, "key"),
      rpcUrl: endpoint,
      helperPath: helper,
      gitCommit: "setup-invocations-uninit",
      sdkVersion: "28.0.0",
    });
  } catch (err) {
    uninitError = err.message;
  }

  // 3. Failure probe: wrong setup order (`add` before `initialize`) fails setup before measurement
  reset();
  const badOrderDir = path.join(temporary, "bad-order");
  fs.mkdirSync(badOrderDir);
  fs.copyFileSync(
    wasmFile,
    path.join(badOrderDir, "initialized_contract.wasm"),
  );
  fs.writeFileSync(
    path.join(badOrderDir, "fixtures.json"),
    JSON.stringify({
      id: "bad-order-probe",
      contracts: [
        {
          id: "initialized-contract",
          wasm_path: "initialized_contract.wasm",
          setup_invocations: [
            {
              id: "premature-add",
              function_name: "add",
              args: [{ type: "u32", value: 12 }],
            },
          ],
          invocations: [{ id: "read", function_name: "read_value", args: [] }],
        },
      ],
    }),
  );
  let badOrderError = null;
  try {
    await runMeasurement({
      fixturesPath: path.join(badOrderDir, "fixtures.json"),
      fixtureId: "bad-order.json",
      keyFile: path.join(badOrderDir, "key"),
      rpcUrl: endpoint,
      helperPath: helper,
      gitCommit: "setup-invocations-bad-order",
      sdkVersion: "28.0.0",
    });
  } catch (err) {
    badOrderError = err.message;
  }
  const badOrderReplays = [...replays];

  write("failure-probes.json", {
    uninitialized_read: { error: uninitError },
    bad_setup_order: { error: badOrderError, replays: badOrderReplays },
  });

  const readBench = records[0].benchmarks.find(
    (b) => b.function_name === "read_value",
  );
  const checkBench = records[0].benchmarks.find(
    (b) => b.function_name === "check_value",
  );
  const readReplay = successReplays.find(
    (r) => r.function_name === "read_value",
  );
  const checkReplay = successReplays.find(
    (r) => r.function_name === "check_value",
  );
  const readRetval = xdr.ScVal.fromXDR(readReplay.retval_xdr, "base64");
  const checkRetval = xdr.ScVal.fromXDR(checkReplay.retval_xdr, "base64");

  const checks = {
    ordered_setup_submissions:
      JSON.stringify(
        successSubmissions.map((s) => s.function_name ?? s.host_function),
      ) ===
      JSON.stringify([
        "hostFunctionTypeUploadContractWasm",
        "hostFunctionTypeCreateContractV2",
        "initialize",
        "add",
      ]),
    all_setup_confirmed_before_measurement:
      successConfirmations.length === 4 &&
      successConfirmations.every((c) => c.status === "SUCCESS") &&
      successTimeline.lastIndexOf("confirmed:SUCCESS") <
        successTimeline.indexOf("measure:read_value"),
    benchmark_reads_committed_value_42:
      readRetval.switch().name === "scvU32" && readRetval.u32() === 42,
    benchmark_check_returns_ok:
      checkRetval.switch().name === "scvSymbol" &&
      checkRetval.sym().toString() === "ok",
    setup_consumption_excluded_from_benchmarks:
      records[0].benchmarks.length === 2 &&
      readBench.metrics.ledger_write_entries.consumed === 0 &&
      readBench.metrics.ledger_write_bytes.consumed === 0 &&
      checkBench.metrics.ledger_write_entries.consumed === 0 &&
      checkBench.metrics.ledger_write_bytes.consumed === 0,
    uninitialized_control_fails:
      typeof uninitError === "string" && uninitError.length > 0,
    bad_setup_order_halts_before_measurement:
      typeof badOrderError === "string" &&
      /setup invocation premature-add \(add\)/.test(badOrderError) &&
      badOrderReplays.length === 0,
  };
  for (const [name, passed] of Object.entries(checks)) {
    assert.equal(passed, true, name);
  }
  write("verification.json", {
    status: "LIVE_SETUP_INVOCATIONS_PROOF_PASS",
    wasm_sha256: wasmSha,
    contract_id: records[0].contract_id,
    checks,
  });

  const hashed = {};
  for (const name of fs.readdirSync(destination).sort()) {
    if (name !== "sha256.json") {
      hashed[name] = sha256(fs.readFileSync(path.join(destination, name)));
    }
  }
  write("sha256.json", hashed);
  fs.rmSync(temporary, { recursive: true, force: true });
  console.log("LIVE_SETUP_INVOCATIONS_PROOF_PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
