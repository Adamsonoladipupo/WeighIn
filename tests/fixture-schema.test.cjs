const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const {
  WEIGHIN_FIXTURES_JSON_SCHEMA,
  toScVal,
} = require("../dist/measurement");
const { parseFixtures } = require("../dist/identity");
const { planSetupOrder } = require("../dist/setup-plan");

function readExample(name) {
  const file = `examples/${name}-fixture.json`;
  return parseFixtures(
    readFileSync(resolve(__dirname, "..", file), "utf8"),
    file,
  );
}

test("published fixture schema is generated from the runtime fixture declarations", () => {
  assert.equal(
    WEIGHIN_FIXTURES_JSON_SCHEMA.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.equal(
    WEIGHIN_FIXTURES_JSON_SCHEMA.title,
    "WeighIn fixture declarations",
  );
  assert.ok(WEIGHIN_FIXTURES_JSON_SCHEMA["x-weighin-identities"]);
  const contract = {
    wasm_path: "contract.wasm",
    invocations: [
      { function_name: "hello", args: [{ type: "symbol", value: "world" }] },
    ],
  };
  const parsed = parseFixtures(
    JSON.stringify({ contracts: [contract] }),
    "fixtures.json",
  );
  assert.equal(parsed.fixture_id, "path:fixtures.json");
  assert.equal(parsed.contracts[0].logical_id, "wasm:contract.wasm");
  assert.match(parsed.contracts[0].invocations[0].case_id, /^args:/);
});

test("fixture schema contract has valid and invalid examples that use runtime validation", () => {
  const valid = {
    id: "suite",
    contracts: [
      {
        id: "contract",
        wasm_path: "contract.wasm",
        invocations: [{ id: "hello", function_name: "hello", args: [] }],
      },
    ],
  };
  assert.doesNotThrow(() =>
    parseFixtures(JSON.stringify(valid), "fixtures.json"),
  );
  const invalid = structuredClone(valid);
  invalid.contracts[0].id = "   ";
  assert.throws(
    () => parseFixtures(JSON.stringify(invalid), "fixtures.json"),
    /ID must not be blank/,
  );
});

test("large-storage example encodes a one-key control and sixteen distinct reads", () => {
  const [contract] = readExample("large-storage").contracts;
  const keySets = contract.invocations.map(({ args: [keys] }) =>
    toScVal(keys)
      .vec()
      .map((key) => key.u32()),
  );
  assert.deepEqual(keySets, [[0], Array.from({ length: 16 }, (_, key) => key)]);
});

test("auth-tree example binds the verifier and encodes both parties and the order", () => {
  const fixture = readExample("auth-tree");
  const order = planSetupOrder(fixture.fixture_id, fixture.contracts);
  assert.deepEqual(
    order.map(({ id }) => id),
    ["verifier", "approval"],
  );
  const [verifier, buyer, seller, orderId] = order[1].invocations[0].args;
  assert.deepEqual(verifier, {
    type: "address",
    binding: { contract: "verifier" },
  });
  const buyerScVal = toScVal(buyer);
  const sellerScVal = toScVal(seller);
  assert.equal(buyerScVal.address().switch().name, "scAddressTypeAccount");
  assert.equal(sellerScVal.address().switch().name, "scAddressTypeAccount");
  assert.notEqual(buyerScVal.toXDR("base64"), sellerScVal.toXDR("base64"));
  assert.equal(toScVal(orderId).u64().toString(), "42");
});

test("bundled setup-invocations fixture parses and validates setup_invocations schema", () => {
  const file = "tests/fixtures/setup-invocations/fixtures.json";
  const parsed = parseFixtures(
    readFileSync(resolve(__dirname, "..", file), "utf8"),
    file,
  );
  assert.equal(parsed.fixture_id, "id:committed-setup-suite");
  assert.equal(parsed.contracts[0].setup_invocations.length, 2);
  assert.deepEqual(
    parsed.contracts[0].setup_invocations.map((s) => s.function_name),
    ["initialize", "add"],
  );
});
