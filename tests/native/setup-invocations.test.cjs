// Real protocol-28 native Soroban host replay for the bundled initialized
// contract built from `tests/fixtures/setup-invocations/src/lib.rs`.
// Proves against the actual compiled WASM and pinned Rust soroban-simulation
// helper that:
// 1. Without committed setup state, `read_value()` and `add(12)` trap.
// 2. `initialize(30)` succeeds once and writes persistent `value = 30`.
// 3. With persistent `value = 30` committed, `initialize(30)` traps
//    ("already initialized") and `add(12)` returns 42 and updates `value`.
// 4. With persistent `value = 42` committed, measured `read_value()` returns 42
//    and `check_value(42)` returns `ok` with zero write entries/bytes (setup
//    write costs are completely excluded from benchmark metrics).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Address, xdr } = require("@stellar/stellar-sdk");
const { simulateSnapshot } = require("../../dist/simulation");
const { metricsFromSimulation } = require("../../dist/measurement");

const helper = path.resolve(
  __dirname,
  "../../native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation",
);
const baseInput = require("../../docs/experiments/compute-source-spike/base-input.json");
const wasmPath = path.resolve(
  __dirname,
  "../fixtures/setup-invocations/target/wasm32v1-none/release/contract_test.wasm",
);

const LIMITS = {
  cpu_instructions: 100_000_000,
  memory_bytes: 41_943_040,
  footprint_entries: 100,
  disk_read_bytes: 200_000,
  write_entries: 50,
  write_bytes: 132_096,
  events_and_return_bytes: 16_384,
};

function configAndAccountEntries() {
  return baseInput.entries.filter((entry) => {
    const kind = xdr.LedgerKey.fromXDR(entry.key, "base64").switch().name;
    return kind === "configSetting" || kind === "account";
  });
}

function buildSnapshotInput({
  wasmBytes,
  contractId,
  functionName,
  args,
  committedValue,
}) {
  const header = xdr.LedgerHeader.fromXDR(baseInput.header_xdr, "base64");
  const ledgerSeq = header.ledgerSeq();
  const liveUntil = ledgerSeq + 50_000;
  const wasmHash = crypto.createHash("sha256").update(wasmBytes).digest();
  const contractAddr = Address.fromString(contractId).toScAddress();
  const extV0 = new xdr.LedgerEntryExt(0).toXDR("base64");

  const codeKey = xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({ hash: wasmHash }),
  );
  const codeData = xdr.LedgerEntryData.contractCode(
    new xdr.ContractCodeEntry({
      ext: new xdr.ContractCodeEntryExt(0),
      hash: wasmHash,
      code: wasmBytes,
    }),
  );

  const instanceKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: contractAddr,
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const instanceData = xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: new xdr.ExtensionPoint(0),
      contract: contractAddr,
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
      val: xdr.ScVal.scvContractInstance(
        new xdr.ScContractInstance({
          executable: xdr.ContractExecutable.contractExecutableWasm(wasmHash),
          storage: [],
        }),
      ),
    }),
  );

  const valueKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: contractAddr,
      key: xdr.ScVal.scvSymbol("value"),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const valueEntry =
    committedValue === undefined
      ? { key: valueKey.toXDR("base64"), xdr: null }
      : {
          key: valueKey.toXDR("base64"),
          xdr: xdr.LedgerEntryData.contractData(
            new xdr.ContractDataEntry({
              ext: new xdr.ExtensionPoint(0),
              contract: contractAddr,
              key: xdr.ScVal.scvSymbol("value"),
              durability: xdr.ContractDataDurability.persistent(),
              val: xdr.ScVal.scvU32(committedValue),
            }),
          ).toXDR("base64"),
          extension_xdr: extV0,
          last_modified: ledgerSeq - 1,
          live_until: liveUntil,
        };

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: contractAddr,
      functionName,
      args,
    }),
  );

  return {
    valueKeyXdr: valueKey.toXDR("base64"),
    input: {
      schema_version: 1,
      header_xdr: baseInput.header_xdr,
      network_passphrase: baseInput.network_passphrase,
      host_function_xdr: hostFunction.toXDR("base64"),
      source_account_xdr: baseInput.source_account_xdr,
      entries: [
        ...configAndAccountEntries(),
        {
          key: codeKey.toXDR("base64"),
          xdr: codeData.toXDR("base64"),
          extension_xdr: extV0,
          last_modified: ledgerSeq - 2,
          live_until: liveUntil,
        },
        {
          key: instanceKey.toXDR("base64"),
          xdr: instanceData.toXDR("base64"),
          extension_xdr: extV0,
          last_modified: ledgerSeq - 2,
          live_until: liveUntil,
        },
        valueEntry,
      ],
      instruction_leeway: 0,
      seed: Array(32).fill(0),
    },
  };
}

test("bundled initialized contract traps without setup and reads committed state after ordered setup in native protocol-28 host", async () => {
  const wasmBytes = fs.readFileSync(wasmPath);
  const contractId = Address.contract(Buffer.alloc(32, 0x42)).toString();

  // 1. Before setup: read_value and add must trap ("not initialized").
  for (const [fn, args] of [
    ["read_value", []],
    ["add", [xdr.ScVal.scvU32(12)]],
  ]) {
    const { input } = buildSnapshotInput({
      wasmBytes,
      contractId,
      functionName: fn,
      args,
      committedValue: undefined,
    });
    await assert.rejects(
      simulateSnapshot(input, helper),
      /host invocation failed/,
      `${fn} must trap when persistent value is not initialized`,
    );
  }

  // 2. Setup step 1: initialize(30) writes persistent `value = 30`.
  const initStep = buildSnapshotInput({
    wasmBytes,
    contractId,
    functionName: "initialize",
    args: [xdr.ScVal.scvU32(30)],
    committedValue: undefined,
  });
  const initOutput = await simulateSnapshot(initStep.input, helper);
  assert.equal(xdr.ScVal.fromXDR(initOutput.retval_xdr, "base64").u32(), 30);
  assert.ok(initOutput.read_write_keys.includes(initStep.valueKeyXdr));
  assert.equal(initOutput.modified_entries, 1);

  // 3. Once `value = 30` is committed: re-running initialize(30) traps,
  //    while setup step 2 `add(12)` succeeds and returns 42.
  const doubleInit = buildSnapshotInput({
    wasmBytes,
    contractId,
    functionName: "initialize",
    args: [xdr.ScVal.scvU32(30)],
    committedValue: 30,
  });
  await assert.rejects(
    simulateSnapshot(doubleInit.input, helper),
    /host invocation failed/,
    "initialize must trap if called against already-initialized state",
  );

  const addStep = buildSnapshotInput({
    wasmBytes,
    contractId,
    functionName: "add",
    args: [xdr.ScVal.scvU32(12)],
    committedValue: 30,
  });
  const addOutput = await simulateSnapshot(addStep.input, helper);
  assert.equal(xdr.ScVal.fromXDR(addOutput.retval_xdr, "base64").u32(), 42);
  assert.ok(addOutput.read_write_keys.includes(addStep.valueKeyXdr));

  // 4. After both setup calls commit (`value = 42`):
  //    read_value() returns 42 and check_value(42) returns `ok` with ZERO writes.
  const readBench = buildSnapshotInput({
    wasmBytes,
    contractId,
    functionName: "read_value",
    args: [],
    committedValue: 42,
  });
  const readOutput = await simulateSnapshot(readBench.input, helper);
  assert.equal(xdr.ScVal.fromXDR(readOutput.retval_xdr, "base64").u32(), 42);
  assert.ok(
    readOutput.read_only_keys.includes(readBench.valueKeyXdr),
    "benchmark read footprint must include committed persistent value key",
  );
  assert.deepEqual(readOutput.read_write_keys, []);
  assert.equal(readOutput.write_bytes, 0);
  assert.equal(readOutput.modified_entries, 0);

  const readMetrics = metricsFromSimulation(readOutput, LIMITS);
  assert.ok(readMetrics.cpu_instructions.consumed > 0);
  assert.ok(readMetrics.memory_bytes.consumed > 0);
  assert.equal(readMetrics.ledger_write_entries.consumed, 0);
  assert.equal(readMetrics.ledger_write_bytes.consumed, 0);

  const checkBench = buildSnapshotInput({
    wasmBytes,
    contractId,
    functionName: "check_value",
    args: [xdr.ScVal.scvU32(42)],
    committedValue: 42,
  });
  const checkOutput = await simulateSnapshot(checkBench.input, helper);
  assert.equal(
    xdr.ScVal.fromXDR(checkOutput.retval_xdr, "base64").sym().toString(),
    "ok",
  );
  assert.deepEqual(checkOutput.read_write_keys, []);

  // Checking a stale/wrong value (30 instead of 42) must trap.
  const wrongCheck = buildSnapshotInput({
    wasmBytes,
    contractId,
    functionName: "check_value",
    args: [xdr.ScVal.scvU32(30)],
    committedValue: 42,
  });
  await assert.rejects(
    simulateSnapshot(wrongCheck.input, helper),
    /host invocation failed/,
  );
});
