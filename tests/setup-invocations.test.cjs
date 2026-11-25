// Deterministic behavior tests for committed fixture setup invocations.
// Covers schema validation, preflight checks, dependency ordering, typed
// bindings into setup calls, real transaction signing/submission/confirmation,
// metric isolation (setup consumption excluded from benchmark metrics),
// the bundled initialized contract proof, and invalid/failure cases.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  Account,
  Address,
  Keypair,
  Operation,
  TransactionBuilder,
  rpc,
  xdr,
} = require("@stellar/stellar-sdk");
const { parseFixtures } = require("../dist/identity");
const { planSetupOrder } = require("../dist/setup-plan");
const { diffBenchmarks } = require("../dist/diff");
const {
  runMeasurement,
  commitSetupInvocations,
  preflightSetupArguments,
  WEIGHIN_FIXTURES_JSON_SCHEMA,
} = require("../dist/measurement");
const { SUPPORTED_NETWORK_PASSPHRASE } = require("../dist/network");

const MAGIC = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const CALLEE_WASM = Buffer.from([...MAGIC, 0x00, 0x01, 0x71]);
const CALLER_WASM = Buffer.from([...MAGIC, 0x00, 0x01, 0x72]);
const BUNDLED_DIR = path.resolve(__dirname, "fixtures/setup-invocations");
const BUNDLED_FIXTURES = path.join(BUNDLED_DIR, "fixtures.json");
const BUNDLED_WASM = path.join(
  BUNDLED_DIR,
  "target/wasm32v1-none/release/contract_test.wasm",
);

const txHash = (n) => n.toString(16).padStart(64, "0");

const TEST_LIMITS = {
  cpu_instructions: 100_000_000,
  memory_bytes: 41_943_040,
  footprint_entries: 100,
  disk_read_bytes: 200_000,
  write_entries: 50,
  write_bytes: 132_096,
  events_and_return_bytes: 16_384,
};

function makeReadOnlySimulationOutput(
  contractId,
  retval,
  cpuConsumed = 240_000,
) {
  const contractAddr = Address.fromString(contractId).toScAddress();
  const instanceKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: contractAddr,
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const valueKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: contractAddr,
      key: xdr.ScVal.scvSymbol("value"),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const readOnlyKeys = [instanceKey.toXDR("base64"), valueKey.toXDR("base64")];
  const txData = new xdr.SorobanTransactionData({
    ext: new xdr.SorobanTransactionDataExt(0),
    resources: new xdr.SorobanResources({
      footprint: new xdr.LedgerFootprint({
        readOnly: [instanceKey, valueKey],
        readWrite: [],
      }),
      instructions: cpuConsumed + 50_000,
      diskReadBytes: 0,
      writeBytes: 0,
    }),
    resourceFee: xdr.Int64.fromString("1000"),
  });
  return {
    schema_version: 1,
    source: "soroban-simulation",
    source_version: "28.0.1",
    protocol: 28,
    host_features: ["recording_mode", "testutils"],
    auth_mode: "recording(true,true)",
    cpu_instructions_consumed: cpuConsumed,
    memory_bytes_consumed: 1_050_000,
    cpu_limit: TEST_LIMITS.cpu_instructions,
    memory_limit: TEST_LIMITS.memory_bytes,
    instruction_budget: cpuConsumed + 50_000,
    disk_read_bytes: 0,
    write_bytes: 0,
    read_only_keys: readOnlyKeys,
    read_write_keys: [],
    retval_xdr: retval.toXDR("base64"),
    transaction_data_xdr: txData.toXDR("base64"),
    contract_events_xdr: [],
    modified_entries: 0,
  };
}

function makeProvenance(sourceAccount) {
  return {
    source: "soroban-simulation",
    source_version: "28.0.1",
    protocol: 28,
    helper_sha256: "a".repeat(64),
    network_id: "b".repeat(64),
    ledger: 120,
    header_sha256: "c".repeat(64),
    snapshot_sha256: "d".repeat(64),
    config_sha256: "e".repeat(64),
    compute_config_sha256: "f".repeat(64),
    input_sha256: "1".repeat(64),
    seed: Array(32).fill(0),
    auth_mode: "recording(true,true)",
    host_features: ["recording_mode", "testutils"],
    source_account: sourceAccount,
    resource_limits_sha256: "2".repeat(64),
  };
}

// Verify that a real Stellar transaction carries a valid Ed25519 signature from deployer.
function assertSignedByDeployer(tx, deployer) {
  assert.ok(
    Array.isArray(tx.signatures) && tx.signatures.length >= 1,
    "submitted transaction must carry at least one signature",
  );
  const hash = tx.hash();
  const verified = tx.signatures.some((decorated) =>
    deployer.verify(hash, decorated.signature()),
  );
  assert.equal(
    verified,
    true,
    "submitted transaction signature must verify against deployer public key",
  );
}

// ---------------------------------------------------------------------------
// 1. Schema, identity, and preflight validation
// ---------------------------------------------------------------------------

test("parseFixtures accepts setup_invocations and keeps benchmark case_ids unaffected", () => {
  const raw = fs.readFileSync(BUNDLED_FIXTURES, "utf8");
  const parsed = parseFixtures(
    raw,
    "tests/fixtures/setup-invocations/fixtures.json",
  );
  assert.equal(parsed.fixture_id, "id:committed-setup-suite");
  assert.equal(parsed.contracts.length, 1);
  assert.equal(parsed.contracts[0].logical_id, "id:initialized-contract");
  assert.equal(parsed.contracts[0].setup_invocations.length, 2);
  assert.deepEqual(
    parsed.contracts[0].setup_invocations.map((s) => s.function_name),
    ["initialize", "add"],
  );
  assert.deepEqual(
    parsed.contracts[0].invocations.map((i) => ({
      function_name: i.function_name,
      case_id: i.case_id,
    })),
    [
      { function_name: "read_value", case_id: "id:read-committed" },
      { function_name: "check_value", case_id: "id:verify-committed" },
    ],
  );
});

test("JSON schema exposes setup_invocations with strict fields and binding args", () => {
  const contractProps =
    WEIGHIN_FIXTURES_JSON_SCHEMA.properties.contracts.items.properties;
  assert.ok(contractProps.setup_invocations, "setup_invocations in schema");
  const setupItem = contractProps.setup_invocations.items;
  assert.equal(setupItem.additionalProperties, false);
  assert.equal(setupItem.properties.id.pattern, "\\S");
  assert.equal(setupItem.properties.args.items.anyOf.length, 2);
});

test("parseFixtures rejects malformed or strict-violating setup_invocations", () => {
  const base = (setup_invocations) =>
    JSON.stringify({
      contracts: [
        {
          id: "c",
          wasm_path: "c.wasm",
          setup_invocations,
          invocations: [{ function_name: "read", args: [] }],
        },
      ],
    });

  // Unknown key on setup invocation
  assert.throws(
    () =>
      parseFixtures(
        base([{ functoin_name: "init", args: [] }]),
        "fixtures.json",
      ),
    /functoin_name/,
  );

  // Blank setup invocation id
  assert.throws(
    () =>
      parseFixtures(
        base([{ id: "   ", function_name: "init", args: [] }]),
        "fixtures.json",
      ),
    /ID must not be blank/,
  );

  // Empty function name
  assert.throws(
    () =>
      parseFixtures(base([{ function_name: "", args: [] }]), "fixtures.json"),
    /setup_invocations\.0\.function_name/,
  );

  // Duplicate setup invocation id within one contract
  assert.throws(
    () =>
      parseFixtures(
        base([
          { id: "step", function_name: "init", args: [] },
          { id: "step", function_name: "add", args: [] },
        ]),
        "fixtures.json",
      ),
    /Duplicate setup invocation id in id:c: id:step/,
  );

  // Empty array is accepted as a no-op
  assert.doesNotThrow(() => parseFixtures(base([]), "fixtures.json"));
});

test("planSetupOrder rejects a setup_invocations binding to an undeclared dependency", () => {
  const parsed = parseFixtures(
    JSON.stringify({
      id: "suite",
      contracts: [
        {
          id: "caller",
          wasm_path: "caller.wasm",
          setup_invocations: [
            {
              id: "wire",
              function_name: "set_callee",
              args: [{ type: "address", binding: { contract: "callee" } }],
            },
          ],
          invocations: [{ function_name: "run", args: [] }],
        },
        {
          id: "callee",
          wasm_path: "callee.wasm",
          invocations: [{ function_name: "work", args: [] }],
        },
      ],
    }),
    "fixtures.json",
  );
  assert.throws(
    () => planSetupOrder(parsed.fixture_id, parsed.contracts),
    /id:caller \/ id:wire \(set_callee\) argument 0 binds "callee", which is not a declared dependency/,
  );
});

test("invalid literal setup arguments fail preflight before any key file or network side effect", async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "weighin-setup-preflight-"),
  );
  try {
    const keyFile = path.join(dir, "key");
    fs.writeFileSync(path.join(dir, "c.wasm"), CALLEE_WASM);
    fs.writeFileSync(
      path.join(dir, "fixtures.json"),
      JSON.stringify({
        id: "preflight-suite",
        contracts: [
          {
            id: "c",
            wasm_path: "c.wasm",
            setup_invocations: [
              {
                id: "bad-bytes",
                function_name: "init",
                args: [{ type: "bytes", value: "abc" }],
              },
            ],
            invocations: [{ function_name: "read", args: [] }],
          },
        ],
      }),
    );

    await assert.rejects(
      runMeasurement({
        fixturesPath: path.join(dir, "fixtures.json"),
        fixtureId: "fixtures.json",
        keyFile,
        gitCommit: "test",
        sdkVersion: "28.0.0",
        rpcUrl: "http://controlled.invalid/rpc",
      }),
      /Preflight validation failed for configured setup invocations[\s\S]*even length/,
    );
    assert.equal(fs.existsSync(keyFile), false, "no deployer key written");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("preflightSetupArguments skips bound args and aggregates literal arg errors", () => {
  assert.throws(
    () =>
      preflightSetupArguments("id:suite", [
        {
          logical_id: "id:c",
          wasm_path: "c.wasm",
          setup_invocations: [
            {
              id: "s1",
              function_name: "init",
              args: [
                { type: "address", binding: { contract: "dep" } },
                { type: "address", value: "NOT_AN_ADDRESS" },
              ],
            },
          ],
        },
      ]),
    /id:c \/ id:s1 \(init\) arg 1.*Invalid value for address/,
  );
});

// ---------------------------------------------------------------------------
// 2. Bundled initialized contract proof: committed state + metric isolation
// ---------------------------------------------------------------------------

test("bundled initialized contract commits setup calls in order, reads committed state, and excludes setup costs from benchmark metrics", async (t) => {
  assert.ok(
    fs.existsSync(BUNDLED_WASM),
    "the source-built setup fixture WASM must exist",
  );
  const wasmBytes = fs.readFileSync(BUNDLED_WASM);
  assert.deepEqual(
    [...wasmBytes.subarray(0, 8)],
    MAGIC,
    "bundled contract must be a valid compiled WASM binary",
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-bundled-setup-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const deployer = Keypair.random();
  const keyFile = path.join(dir, "deployer.key");
  fs.writeFileSync(keyFile, deployer.secret(), { mode: 0o600 });

  // Stateful controlled ledger tracking deployed contracts and persistent `value`.
  const ledgerState = new Map(); // contractId -> { deployed: boolean, value: number | undefined }
  const timeline = [];
  const submittedSetupCalls = [];
  let seq = 100n;
  let ledgerSeq = 50;
  let sendCount = 0;
  const pendingTx = new Map(); // txHash -> { kind, contractId, fn, args }

  t.mock.method(console, "log", () => {});
  t.mock.method(
    require("../dist/account"),
    "ensureAccountReady",
    async () => {},
  );
  t.mock.method(rpc.Server.prototype, "getAccount", async (address) => {
    return new Account(address, seq.toString());
  });
  t.mock.method(rpc.Server.prototype, "getLedgerEntries", async (key) => {
    const cid = Address.fromScAddress(key.contractData().contract()).toString();
    const state = ledgerState.get(cid);
    if (!state?.deployed) return { entries: [], latestLedger: ledgerSeq };
    return {
      entries: [
        {
          key: key.toXDR("base64"),
          xdr: xdr.LedgerEntryData.contractData(
            new xdr.ContractDataEntry({
              ext: new xdr.ExtensionPoint(0),
              contract: key.contractData().contract(),
              key: xdr.ScVal.scvLedgerKeyContractInstance(),
              durability: xdr.ContractDataDurability.persistent(),
              val: xdr.ScVal.scvContractInstance(
                new xdr.ScContractInstance({
                  executable: xdr.ContractExecutable.contractExecutableWasm(
                    crypto.createHash("sha256").update(wasmBytes).digest(),
                  ),
                  storage: [],
                }),
              ),
            }),
          ).toXDR("base64"),
          liveUntilLedgerSeq: ledgerSeq + 50_000,
        },
      ],
      latestLedger: ledgerSeq,
    };
  });
  t.mock.method(rpc.Server.prototype, "prepareTransaction", async (tx) => {
    const op = tx.operations[0];
    const fnType = op.func.switch().name;
    if (fnType === "hostFunctionTypeInvokeContract") {
      const invoke = op.func.invokeContract();
      const cid = Address.fromScAddress(invoke.contractAddress()).toString();
      const fn = invoke.functionName().toString();
      const state = ledgerState.get(cid);
      if (!state?.deployed) {
        throw new Error(`Contract ${cid} is not deployed`);
      }
      if (fn === "initialize" && state.value !== undefined) {
        throw new Error("HostError: already initialized");
      }
      if (fn === "add" && state.value === undefined) {
        throw new Error("HostError: not initialized");
      }
      timeline.push(`prepare:setup:${fn}`);
    } else if (fnType === "hostFunctionTypeUploadContractWasm") {
      timeline.push("prepare:upload");
    } else if (fnType === "hostFunctionTypeCreateContractV2") {
      timeline.push("prepare:create");
    }
    return tx;
  });
  t.mock.method(rpc.Server.prototype, "sendTransaction", async (tx) => {
    assertSignedByDeployer(tx, deployer);
    seq += 1n;
    sendCount += 1;
    const h = txHash(sendCount);
    const op = tx.operations[0];
    const fnType = op.func.switch().name;
    if (fnType === "hostFunctionTypeUploadContractWasm") {
      pendingTx.set(h, { kind: "upload" });
      timeline.push("submit:upload");
    } else if (fnType === "hostFunctionTypeCreateContractV2") {
      const preimage = op.func
        .createContractV2()
        .contractIdPreimage()
        .fromAddress();
      const salt = preimage.salt();
      const contractId = require("../dist/measurement").calculateContractId(
        deployer.publicKey(),
        salt,
      );
      pendingTx.set(h, { kind: "create", contractId });
      timeline.push("submit:create");
    } else if (fnType === "hostFunctionTypeInvokeContract") {
      const invoke = op.func.invokeContract();
      const contractId = Address.fromScAddress(
        invoke.contractAddress(),
      ).toString();
      const fn = invoke.functionName().toString();
      const args = invoke.args();
      pendingTx.set(h, { kind: "setup", contractId, fn, args });
      submittedSetupCalls.push({
        contractId,
        fn,
        sequence: tx.sequence,
        args: args.map((a) => a.u32()),
      });
      timeline.push(`submit:setup:${fn}`);
    }
    return { status: "PENDING", hash: h };
  });
  t.mock.method(rpc.Server.prototype, "getTransaction", async (h) => {
    ledgerSeq += 1;
    const tx = pendingTx.get(h);
    assert.ok(tx, `unexpected transaction hash ${h}`);
    if (tx.kind === "upload") {
      timeline.push("confirm:upload");
      return { status: "SUCCESS", ledger: ledgerSeq };
    }
    if (tx.kind === "create") {
      ledgerState.set(tx.contractId, { deployed: true, value: undefined });
      timeline.push("confirm:create");
      return {
        status: "SUCCESS",
        ledger: ledgerSeq,
        returnValue: Address.fromString(tx.contractId).toScVal(),
      };
    }
    if (tx.kind === "setup") {
      const state = ledgerState.get(tx.contractId);
      if (tx.fn === "initialize") {
        assert.equal(state.value, undefined, "initialize must run once");
        state.value = tx.args[0].u32();
      } else if (tx.fn === "add") {
        assert.notEqual(
          state.value,
          undefined,
          "add must observe initialized state",
        );
        state.value += tx.args[0].u32();
      }
      timeline.push(`confirm:setup:${tx.fn}`);
      return {
        status: "SUCCESS",
        ledger: ledgerSeq,
        returnValue: xdr.ScVal.scvU32(state.value),
      };
    }
    throw new Error(`unexpected tx kind ${tx.kind}`);
  });
  t.mock.method(
    require("../dist/simulation"),
    "resolveSimulationHelper",
    async () => "/fake/helper",
  );
  t.mock.method(
    require("../dist/simulation"),
    "measureInvocation",
    async (_rpcUrl, tx) => {
      const invoke = tx.operations[0].func.invokeContract();
      const cid = Address.fromScAddress(invoke.contractAddress()).toString();
      const fn = invoke.functionName().toString();
      const args = invoke.args();
      timeline.push(`measure:${fn}`);
      const state = ledgerState.get(cid);
      if (state?.value === undefined) {
        throw new Error(`Simulation failed for ${fn}: not initialized`);
      }
      let retval;
      if (fn === "read_value") {
        retval = xdr.ScVal.scvU32(state.value);
      } else if (fn === "check_value") {
        const expected = args[0].u32();
        if (state.value !== expected) {
          throw new Error(
            `Simulation failed for ${fn}: unexpected committed value (expected=${expected}, actual=${state.value})`,
          );
        }
        retval = xdr.ScVal.scvSymbol("ok");
      } else {
        throw new Error(`Unexpected measured function ${fn}`);
      }
      return {
        output: makeReadOnlySimulationOutput(cid, retval),
        provenance: makeProvenance(deployer.publicKey()),
        limits: TEST_LIMITS,
      };
    },
  );

  // Run 1 (HEAD)
  const headResults = await runMeasurement({
    fixturesPath: BUNDLED_FIXTURES,
    fixtureId: "tests/fixtures/setup-invocations/fixtures.json",
    keyFile,
    gitCommit: "1".repeat(40),
    sdkVersion: "28.0.0",
    rpcUrl: "http://controlled.invalid/rpc",
    helperPath: "/fake/helper",
  });

  // Verify exact ordered lifecycle: deploy -> setup[0] confirmed -> setup[1] confirmed -> measurements
  assert.deepEqual(timeline, [
    "prepare:upload",
    "submit:upload",
    "confirm:upload",
    "prepare:create",
    "submit:create",
    "confirm:create",
    "prepare:setup:initialize",
    "submit:setup:initialize",
    "confirm:setup:initialize",
    "prepare:setup:add",
    "submit:setup:add",
    "confirm:setup:add",
    "measure:read_value",
    "measure:check_value",
  ]);
  assert.equal(submittedSetupCalls.length, 2);
  assert.deepEqual(
    submittedSetupCalls.map((c) => [c.fn, c.args]),
    [
      ["initialize", [30]],
      ["add", [12]],
    ],
  );
  assert.notEqual(
    submittedSetupCalls[0].sequence,
    submittedSetupCalls[1].sequence,
    "each setup call fetches a fresh account sequence",
  );

  // Verify committed state reached 42 and benchmark metrics exclude setup writes/calls.
  assert.equal(headResults.length, 1);
  const headContract = headResults[0];
  assert.equal(ledgerState.get(headContract.contract_id).value, 42);
  assert.deepEqual(
    headContract.benchmarks.map((b) => [b.function_name, b.case_id]),
    [
      ["read_value", "id:read-committed"],
      ["check_value", "id:verify-committed"],
    ],
  );
  for (const bench of headContract.benchmarks) {
    assert.equal(
      bench.metrics.ledger_write_entries.consumed,
      0,
      "setup write entries must not leak into read benchmark metrics",
    );
    assert.equal(
      bench.metrics.ledger_write_bytes.consumed,
      0,
      "setup write bytes must not leak into read benchmark metrics",
    );
    assert.equal(bench.metrics.ledger_read_entries.consumed, 2);
  }

  // Run 2 (BASE) with the SAME deployer keyFile and SAME WASM on the SAME network:
  // Fresh deployment isolation guarantees `initialize` does not collide with Run 1,
  // and diffBenchmarks pairs logically despite distinct runtime contract_ids.
  const baseResults = await runMeasurement({
    fixturesPath: BUNDLED_FIXTURES,
    fixtureId: "tests/fixtures/setup-invocations/fixtures.json",
    keyFile,
    gitCommit: "2".repeat(40),
    sdkVersion: "28.0.0",
    rpcUrl: "http://controlled.invalid/rpc",
    helperPath: "/fake/helper",
  });
  assert.notEqual(
    baseResults[0].contract_id,
    headResults[0].contract_id,
    "contracts with setup_invocations deploy fresh isolated instances per run",
  );
  const diff = diffBenchmarks(baseResults, headResults);
  assert.equal(diff.contracts.length, 1);
  assert.equal(diff.contracts[0].functions.length, 2);
  assert.equal(diff.hasRegression, false);
});

// ---------------------------------------------------------------------------
// 3. Dependency-ordered setup calls with typed bindings
// ---------------------------------------------------------------------------

test("dependent contract setup_invocations receive dependency's committed address after dependency setup finishes", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-setup-dep-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const deployer = Keypair.random();
  fs.writeFileSync(path.join(dir, "key"), deployer.secret(), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "callee.wasm"), CALLEE_WASM);
  fs.writeFileSync(path.join(dir, "caller.wasm"), CALLER_WASM);

  // Declare caller first to prove topological ordering applies to both deploy and setup_invocations.
  fs.writeFileSync(
    path.join(dir, "fixtures.json"),
    JSON.stringify({
      id: "dep-setup-suite",
      contracts: [
        {
          id: "caller",
          wasm_path: "caller.wasm",
          depends_on: ["callee"],
          setup_invocations: [
            {
              id: "wire-callee",
              function_name: "set_callee",
              args: [{ type: "address", binding: { contract: "callee" } }],
            },
          ],
          invocations: [
            { id: "invoke-caller", function_name: "run", args: [] },
          ],
        },
        {
          id: "callee",
          wasm_path: "callee.wasm",
          setup_invocations: [
            {
              id: "seed-callee",
              function_name: "initialize",
              args: [{ type: "u32", value: 7 }],
            },
          ],
          invocations: [
            { id: "invoke-callee", function_name: "read", args: [] },
          ],
        },
      ],
    }),
  );

  const events = [];
  const deployedIds = {};
  let receivedCalleeArg = null;
  let seq = 1n;
  let sendCount = 0;
  const pending = new Map();

  t.mock.method(console, "log", () => {});
  t.mock.method(
    require("../dist/account"),
    "ensureAccountReady",
    async () => {},
  );
  t.mock.method(
    rpc.Server.prototype,
    "getAccount",
    async (address) => new Account(address, (seq++).toString()),
  );
  t.mock.method(rpc.Server.prototype, "getLedgerEntries", async () => ({
    entries: [],
  }));
  t.mock.method(rpc.Server.prototype, "prepareTransaction", async (tx) => tx);
  t.mock.method(rpc.Server.prototype, "sendTransaction", async (tx) => {
    assertSignedByDeployer(tx, deployer);
    const h = txHash(++sendCount);
    const op = tx.operations[0];
    const kind = op.func.switch().name;
    if (kind === "hostFunctionTypeUploadContractWasm") {
      const who = op.func.wasm().equals(CALLEE_WASM) ? "callee" : "caller";
      pending.set(h, { kind: "upload", who });
      events.push(`upload:${who}`);
    } else if (kind === "hostFunctionTypeCreateContractV2") {
      const create = op.func.createContractV2();
      const who = create
        .executable()
        .wasmHash()
        .equals(crypto.createHash("sha256").update(CALLEE_WASM).digest())
        ? "callee"
        : "caller";
      const cid = require("../dist/measurement").calculateContractId(
        deployer.publicKey(),
        create.contractIdPreimage().fromAddress().salt(),
      );
      deployedIds[who] = cid;
      pending.set(h, { kind: "create", who, cid });
      events.push(`create:${who}`);
    } else if (kind === "hostFunctionTypeInvokeContract") {
      const invoke = op.func.invokeContract();
      const cid = Address.fromScAddress(invoke.contractAddress()).toString();
      const fn = invoke.functionName().toString();
      const who = cid === deployedIds.callee ? "callee" : "caller";
      if (who === "caller" && fn === "set_callee") {
        receivedCalleeArg = invoke.args()[0];
      }
      pending.set(h, { kind: "setup", who, fn });
      events.push(`setup:${who}:${fn}`);
    }
    return { status: "PENDING", hash: h };
  });
  t.mock.method(rpc.Server.prototype, "getTransaction", async (h) => {
    const item = pending.get(h);
    events.push(`confirm:${item.kind}:${item.who}`);
    return {
      status: "SUCCESS",
      ledger: 10 + sendCount,
      returnValue:
        item.kind === "create"
          ? Address.fromString(item.cid).toScVal()
          : xdr.ScVal.scvVoid(),
    };
  });
  t.mock.method(
    require("../dist/simulation"),
    "resolveSimulationHelper",
    async () => "/fake/helper",
  );
  t.mock.method(
    require("../dist/simulation"),
    "measureInvocation",
    async (_rpcUrl, tx) => {
      const invoke = tx.operations[0].func.invokeContract();
      const cid = Address.fromScAddress(invoke.contractAddress()).toString();
      const fn = invoke.functionName().toString();
      events.push(`measure:${fn}`);
      return {
        output: makeReadOnlySimulationOutput(cid, xdr.ScVal.scvU32(7)),
        provenance: makeProvenance(deployer.publicKey()),
        limits: TEST_LIMITS,
      };
    },
  );

  const results = await runMeasurement({
    fixturesPath: path.join(dir, "fixtures.json"),
    fixtureId: "fixtures.json",
    keyFile: path.join(dir, "key"),
    gitCommit: "3".repeat(40),
    sdkVersion: "28.0.0",
    rpcUrl: "http://controlled.invalid/rpc",
    helperPath: "/fake/helper",
  });

  assert.deepEqual(events, [
    "upload:callee",
    "confirm:upload:callee",
    "create:callee",
    "confirm:create:callee",
    "setup:callee:initialize",
    "confirm:setup:callee",
    "upload:caller",
    "confirm:upload:caller",
    "create:caller",
    "confirm:create:caller",
    "setup:caller:set_callee",
    "confirm:setup:caller",
    "measure:run",
    "measure:read",
  ]);
  assert.ok(receivedCalleeArg, "caller setup must receive bound callee arg");
  assert.equal(receivedCalleeArg.switch().name, "scvAddress");
  assert.equal(
    Address.fromScVal(receivedCalleeArg).toString(),
    deployedIds.callee,
  );
  // Only benchmark invocations appear in results (in fixture declaration order).
  assert.deepEqual(
    results.map((r) => [
      r.logical_id,
      r.benchmarks.map((b) => b.function_name),
    ]),
    [
      ["id:caller", ["run"]],
      ["id:callee", ["read"]],
    ],
  );
});

// ---------------------------------------------------------------------------
// 4. Failure, authorization, pre-existing instance, and cancellation cases
// ---------------------------------------------------------------------------

function failureScenario(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-setup-fail-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const deployer = Keypair.random();
  fs.writeFileSync(path.join(dir, "key"), deployer.secret(), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "callee.wasm"), CALLEE_WASM);
  fs.writeFileSync(path.join(dir, "caller.wasm"), CALLER_WASM);
  fs.writeFileSync(
    path.join(dir, "fixtures.json"),
    JSON.stringify({
      id: "fail-suite",
      contracts: [
        {
          id: "caller",
          wasm_path: "caller.wasm",
          depends_on: ["callee"],
          invocations: [{ id: "run", function_name: "run", args: [] }],
        },
        {
          id: "callee",
          wasm_path: "callee.wasm",
          setup_invocations: options.setupInvocations ?? [
            {
              id: "step1",
              function_name: "initialize",
              args: [{ type: "u32", value: 1 }],
            },
            {
              id: "step2",
              function_name: "add",
              args: [{ type: "u32", value: 2 }],
            },
          ],
          invocations: [{ id: "read", function_name: "read", args: [] }],
        },
      ],
    }),
  );

  const submittedFns = [];
  const measured = [];
  let seq = 1n;
  let sendCount = 0;
  let pollCount = 0;
  let setupStepIndex = 0;
  let lastContractId;

  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
  if (options.fakeTimers) {
    t.mock.method(globalThis, "setTimeout", (cb) => setImmediate(cb));
  }
  t.mock.method(
    require("../dist/account"),
    "ensureAccountReady",
    async () => {},
  );
  t.mock.method(
    rpc.Server.prototype,
    "getAccount",
    async (address) => new Account(address, (seq++).toString()),
  );
  t.mock.method(rpc.Server.prototype, "getLedgerEntries", async (key) => {
    const cid = Address.fromScAddress(key.contractData().contract()).toString();
    lastContractId = cid;
    if (options.alreadyDeployed) {
      return {
        entries: [
          {
            key: key.toXDR("base64"),
            xdr: xdr.LedgerEntryData.contractData(
              new xdr.ContractDataEntry({
                ext: new xdr.ExtensionPoint(0),
                contract: key.contractData().contract(),
                key: xdr.ScVal.scvLedgerKeyContractInstance(),
                durability: xdr.ContractDataDurability.persistent(),
                val: xdr.ScVal.scvVoid(),
              }),
            ).toXDR("base64"),
            liveUntilLedgerSeq: 999999,
          },
        ],
        latestLedger: 1,
      };
    }
    return { entries: [] };
  });
  t.mock.method(rpc.Server.prototype, "prepareTransaction", async (tx) => {
    const op = tx.operations[0];
    if (op.func.switch().name === "hostFunctionTypeInvokeContract") {
      const idx = setupStepIndex++;
      if (options.onPrepareSetup) {
        return options.onPrepareSetup(tx, idx, deployer);
      }
    }
    return tx;
  });
  t.mock.method(rpc.Server.prototype, "sendTransaction", async (tx) => {
    sendCount += 1;
    const op = tx.operations[0];
    const kind = op.func.switch().name;
    if (kind === "hostFunctionTypeInvokeContract") {
      const fn = op.func.invokeContract().functionName().toString();
      submittedFns.push(fn);
      if (options.onSendSetup) {
        return options.onSendSetup(fn, submittedFns.length, sendCount);
      }
    }
    return { status: "PENDING", hash: txHash(sendCount) };
  });
  t.mock.method(rpc.Server.prototype, "getTransaction", async (h) => {
    pollCount += 1;
    // sendCount 1 = upload, 2 = create, >=3 = setup invocations
    if (sendCount === 2) {
      return {
        status: "SUCCESS",
        returnValue: Address.fromString(lastContractId).toScVal(),
      };
    }
    if (sendCount >= 3 && options.onPollSetup) {
      return options.onPollSetup(h, submittedFns.length, pollCount);
    }
    return { status: "SUCCESS" };
  });
  t.mock.method(
    require("../dist/simulation"),
    "resolveSimulationHelper",
    async () => "/fake/helper",
  );
  t.mock.method(
    require("../dist/simulation"),
    "measureInvocation",
    async (_rpcUrl, tx) => {
      measured.push(
        tx.operations[0].func.invokeContract().functionName().toString(),
      );
      return {
        output: makeReadOnlySimulationOutput(
          lastContractId,
          xdr.ScVal.scvU32(1),
        ),
        provenance: makeProvenance(deployer.publicKey()),
        limits: TEST_LIMITS,
      };
    },
  );

  return {
    submittedFns,
    measured,
    getSendCount: () => sendCount,
    getPollCount: () => pollCount,
    run: (extra = {}) =>
      runMeasurement({
        fixturesPath: path.join(dir, "fixtures.json"),
        fixtureId: "fixtures.json",
        keyFile: path.join(dir, "key"),
        gitCommit: "4".repeat(40),
        sdkVersion: "28.0.0",
        rpcUrl: options.rpcUrl ?? "http://controlled.invalid/rpc",
        helperPath: "/fake/helper",
        ...extra,
      }),
  };
}

test("setup preparation failure aborts remaining setup, dependents, and measurement, and redacts endpoint secrets", async (t) => {
  const secretRpc = "http://user:topsecret@host:8000/rpc?api_key=leakme";
  const { submittedFns, measured, run } = failureScenario(t, {
    rpcUrl: secretRpc,
    onPrepareSetup: () => {
      throw new Error(`RPC failed at ${secretRpc}`);
    },
  });
  await assert.rejects(run(), (err) => {
    assert.match(
      err.message,
      /setup invocation step1 \(initialize\) on id:callee preparation failed/,
    );
    assert.match(
      err.message,
      /Setup of id:callee failed; aborted dependents: id:caller/,
    );
    assert.ok(!err.message.includes("topsecret"));
    assert.ok(!err.message.includes("leakme"));
    return true;
  });
  assert.deepEqual(submittedFns, []);
  assert.deepEqual(measured, []);
});

test("setup invocation requiring non-source-account authorization is rejected fail-closed before signing or submitting", async (t) => {
  const externalAccount = Keypair.random().publicKey();
  const { submittedFns, measured, run } = failureScenario(t, {
    onPrepareSetup: (tx) => {
      const authEntry = new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
          new xdr.SorobanAddressCredentials({
            address: Address.fromString(externalAccount).toScAddress(),
            nonce: xdr.Int64.fromString("1"),
            signatureExpirationLedger: 500,
            signature: xdr.ScVal.scvVoid(),
          }),
        ),
        rootInvocation: new xdr.SorobanAuthorizedInvocation({
          function:
            xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
              tx.operations[0].func.invokeContract(),
            ),
          subInvocations: [],
        }),
      });
      // Return a transaction-like object with the prepared auth entry.
      return {
        operations: [{ type: "invokeHostFunction", auth: [authEntry] }],
        sign() {
          throw new Error("must not sign unsupported auth");
        },
      };
    },
  });
  await assert.rejects(
    run(),
    /requires unsupported authorization \(sorobanCredentialsAddress\)/,
  );
  assert.deepEqual(submittedFns, []);
  assert.deepEqual(measured, []);
});

test("setup invocation with deployer source-account authorization is accepted and signed", async (t) => {
  const deployer = Keypair.random();
  const contractId = Address.contract(Buffer.alloc(32, 9)).toString();
  const server = new rpc.Server("http://controlled.invalid/rpc", {
    allowHttp: true,
  });
  let signed = false;
  t.mock.method(console, "log", () => {});
  t.mock.method(server, "getAccount", async (addr) => new Account(addr, "10"));
  t.mock.method(server, "prepareTransaction", async (tx) => {
    const authEntry = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function:
          xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            tx.operations[0].func.invokeContract(),
          ),
        subInvocations: [],
      }),
    });
    tx.operations[0].auth = [authEntry];
    return tx;
  });
  t.mock.method(server, "sendTransaction", async (tx) => {
    assertSignedByDeployer(tx, deployer);
    signed = true;
    return { status: "PENDING", hash: txHash(99) };
  });
  t.mock.method(server, "getTransaction", async () => ({
    status: "SUCCESS",
    ledger: 77,
    returnValue: xdr.ScVal.scvBool(true),
  }));

  const receipts = await commitSetupInvocations({
    server,
    deployer,
    contractId,
    logicalId: "id:admin-contract",
    setupInvocations: [
      { id: "auth-init", function_name: "initialize", args: [] },
    ],
    rpcUrl: "http://controlled.invalid/rpc",
  });
  assert.equal(signed, true);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].id, "auth-init");
  assert.equal(receipts[0].tx_hash, txHash(99));
  assert.equal(receipts[0].ledger, 77);
});

for (const [label, response] of [
  ["ERROR", { status: "ERROR", hash: txHash(5) }],
  ["TRY_AGAIN_LATER", { status: "TRY_AGAIN_LATER", hash: txHash(5) }],
  ["unrecognized status", { status: "UNKNOWN", hash: txHash(5) }],
  ["PENDING without valid hash", { status: "PENDING", hash: "bad-hash" }],
]) {
  test(`setup submission returning ${label} fails before polling and aborts remaining setup and dependents`, async (t) => {
    const { submittedFns, measured, getPollCount, run } = failureScenario(t, {
      onSendSetup: () => response,
    });
    await assert.rejects(run(), (err) => {
      assert.match(
        err.message,
        /setup invocation step1 \(initialize\) on id:callee/,
      );
      assert.match(err.message, /aborted dependents: id:caller/);
      return true;
    });
    assert.deepEqual(submittedFns, ["initialize"]);
    assert.equal(getPollCount(), 2, "only upload and create were polled");
    assert.deepEqual(measured, []);
  });
}

test("second setup call confirmation FAILED stops before third setup call, dependents, and measurement", async (t) => {
  const { submittedFns, measured, run } = failureScenario(t, {
    setupInvocations: [
      {
        id: "s1",
        function_name: "initialize",
        args: [{ type: "u32", value: 1 }],
      },
      { id: "s2", function_name: "add", args: [{ type: "u32", value: 2 }] },
      { id: "s3", function_name: "finalize", args: [] },
    ],
    onPollSetup: (_h, setupCount) => ({
      status: setupCount === 2 ? "FAILED" : "SUCCESS",
    }),
  });
  await assert.rejects(run(), (err) => {
    assert.match(
      err.message,
      /setup invocation s2 \(add\) on id:callee transaction .* did not succeed \(status=FAILED\)/,
    );
    assert.match(err.message, /aborted dependents: id:caller/);
    return true;
  });
  assert.deepEqual(submittedFns, ["initialize", "add"]);
  assert.deepEqual(measured, []);
});

test("unconfirmed setup invocation exhausts 30-poll timeout and stops before measurement", async (t) => {
  const { submittedFns, measured, run } = failureScenario(t, {
    fakeTimers: true,
    onPollSetup: () => ({ status: "NOT_FOUND" }),
  });
  await assert.rejects(run(), /not found after 30 seconds/);
  assert.deepEqual(submittedFns, ["initialize"]);
  assert.deepEqual(measured, []);
});

test("setup invocations fail closed when contract instance is already deployed", async (t) => {
  const { submittedFns, measured, run } = failureScenario(t, {
    alreadyDeployed: true,
  });
  await assert.rejects(run(), (err) => {
    assert.match(
      err.message,
      /already deployed on the network; refusing to run setup invocations against pre-existing state/,
    );
    assert.match(err.message, /aborted dependents: id:caller/);
    return true;
  });
  assert.deepEqual(submittedFns, []);
  assert.deepEqual(measured, []);
});

test("cancellation during setup invocations rethrows cancellation unchanged and skips measurement", async (t) => {
  const controller = new AbortController();
  const reason = new Error("user aborted setup");
  const { submittedFns, measured, run } = failureScenario(t, {
    onPrepareSetup: (tx) => {
      controller.abort(reason);
      return tx;
    },
  });
  await assert.rejects(run({ signal: controller.signal }), (err) => {
    assert.equal(err, reason);
    return true;
  });
  assert.deepEqual(submittedFns, []);
  assert.deepEqual(measured, []);
});
