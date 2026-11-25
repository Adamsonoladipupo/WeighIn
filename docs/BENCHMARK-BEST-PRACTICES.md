# Deterministic benchmark fixtures and simulation best practices

This guide explains how to write deterministic Soroban test fixtures and run reproducible contract simulations with WeighIn. It focuses on **fixture design, ledger state hygiene, avoiding randomness, realistic payload sizing, and simulation repeatability**. For choosing `weighin.toml` regression thresholds and absolute caps, see [Soroban resource budgeting best practices](BEST-PRACTICES.md).

WeighIn measures metered Soroban cost-model consumption through official native simulation (`soroban-simulation` / `soroban-env-host` 28.0.1) against RPC-captured ledger snapshots on the supported Linux x64, standalone protocol-28 path. Because those metrics count abstract protocol units rather than host CPU cycles or wall-clock time, unexpected deltas between BASE and HEAD almost always come from **fixture state drift, time or PRNG dependencies, unpinned toolchains, or unrepresentative inputs**.

---

## 1. Keep mock ledger state consistent

WeighIn executes every benchmark run in two phases:

1. **Setup:** Each contract in `weighin-fixtures.json` is uploaded and deployed once per revision in deterministic topological `depends_on` order (with fixture declaration order breaking ties).
2. **Measurement:** Each declared `invocation` is simulated independently against a single immutable RPC-captured ledger snapshot, and all simulated writes are **discarded**.

Understanding this lifecycle prevents the most common sources of state-induced benchmark drift.

### Never chain state across measured invocations

Because every measured invocation runs against a snapshot and discards its writes, invocation `B` never observes storage mutations performed by invocation `A`.

- **Do not** design a fixture where invocation 1 calls `initialize()` or `deposit()` and invocation 2 expects that balance to exist on-chain.
- **Do** make each measured invocation self-contained against the contract state committed before measurement begins.

### Seed deterministic state in `__constructor` or committed setup

When a contract needs populated storage before benchmarks run, initialize that state deterministically at deployment time in `__constructor` rather than relying on manual pre-run transactions or ambient ledger state.

```rust
#![no_std]

use soroban_sdk::{contract, contractimpl, Bytes, Env, Vec};

#[contract]
pub struct StorageFixture;

#[contractimpl]
impl StorageFixture {
    pub fn __constructor(env: Env) {
        let value = Bytes::from_array(&env, &[0; 2048]);
        for key in 0..16_u32 {
            env.storage().persistent().set(&key, &value);
        }
    }

    pub fn read_entries(env: Env, keys: Vec<u32>) -> u32 {
        keys.iter()
            .map(|key| env.storage().persistent().get::<_, Bytes>(&key).unwrap().len())
            .sum()
    }
}
```

See [`examples/fixture-storage.rs`](../examples/fixture-storage.rs) for the complete example. When benchmarked scenarios require external classic ledger state—such as funded accounts, trustlines, and Stellar Asset Contract (SAC) balances—provision them from a repeatable setup harness against a **fresh disposable standalone network** (see [Funded standard token transfer](token-transfer.md)).

### Declare cross-contract dependencies explicitly instead of hardcoding addresses

Runtime contract addresses (`C...`) depend on the deployer account and WASM hash, so they change across revisions and fresh networks. Hardcoding deployed contract addresses in `weighin-fixtures.json` causes BASE and HEAD to either target stale instances or fail to resolve.

Use `depends_on` and typed `binding` arguments so WeighIn deploys prerequisites first and injects each dependency's verified create return value automatically:

```json
{
  "id": "pool-suite",
  "contracts": [
    {
      "id": "pool",
      "wasm_path": "contract/target/wasm32v1-none/release/pool.wasm",
      "depends_on": ["token"],
      "invocations": [
        {
          "id": "deposit-standard",
          "function_name": "deposit",
          "args": [
            { "type": "address", "binding": { "contract": "token" } },
            { "type": "i128", "value": "1000000000" }
          ]
        }
      ]
    },
    {
      "id": "token",
      "wasm_path": "contract/target/wasm32v1-none/release/token.wasm",
      "invocations": [
        { "id": "token-name", "function_name": "name", "args": [] }
      ]
    }
  ]
}
```

Case identity is derived from the `binding` declaration rather than the runtime address, so BASE and HEAD pair reliably even when the dependency WASM or runtime address changes. See [Fixture setup plan and typed setup bindings](setup-plan.md).

### Eliminate ledger-sequence and timestamp drift

Each invocation snapshot is immutable only for that single captured ledger. On a live standalone network, BASE and HEAD—or consecutive local runs—are captured at **different ledger sequences and timestamps**.

As proven in the [controlled ledger-variation proof](ledger-variation.md), an unchanged WASM artifact whose execution path branches or loops on `env.ledger().sequence()` or `env.ledger().timestamp()` produces real, ledger-attributable resource variation (`+52,966` CPU instructions and `+70,658` memory bytes across ledgers 900–1000 in the archived proof), which WeighIn correctly surfaces as a regression.

To keep fixtures immune to advancing ledger headers:

- **Avoid wall-clock or ledger-height boundaries near the standalone ledger range:** Do not hardcode deadline timestamps or sequence thresholds that a fresh Quickstart ledger can cross between BASE and HEAD measurements.
- **Parameterize time-sensitive logic when benchmarking core math:** If a contract computes interest accrual, vesting schedules, auction expiry, or oracle staleness, pass the evaluation timestamp or elapsed window explicitly to the benchmarked helper—or pick fixed fixture deadlines far enough in the past or future so both revisions always execute the same branch.
- **Split pre-threshold and post-threshold paths into separate cases:** Measure "active window" and "expired window" as two distinct invocation IDs with unambiguous inputs rather than relying on ledger progression.

### Manage TTL and avoid expired or archived state

WeighIn operates strictly on live current-state RPC captures and fails closed on expiring or archived entries:

- **Reused deployments:** When an existing contract instance is reused, WeighIn verifies that both the contract instance and its WASM code entry have at least `minTtlLedgers` remaining (default `17,280`, roughly one day at 5 seconds per ledger). WeighIn never extends TTLs, redeploys silently, or restores archived state ([Native simulation measurement](native-measurement.md#reusing-an-existing-deployment)).
- **Temporary storage expiry:** Once the ledger passes a temporary entry's `liveUntilLedgerSeq`, RPC omits the entry from live state; if an expired entry is fed to the native helper against a later ledger header, the helper exits nonzero with `archived ledger state is unsupported` ([Temporary-entry TTL proof](temporary-ttl.md)).

Best practices:

- Start a **fresh disposable standalone Quickstart container** for each CI job (for example via `scripts/start-local-network.sh`) instead of reusing a long-lived container whose entries age across days.
- If you reuse a local standalone container during development, restart it cleanly or rotate the deployer key whenever deployments approach their TTL window.

### Keep invoking source accounts consistent and valid

WeighIn records the invoking account in `provenance.source_account` and refuses to compare two saved records measured under different source accounts (`Incompatible measurement environment: source_account`).

- Use the same deployer/source account configuration for BASE and HEAD comparisons.
- When a fixture passes explicit Ed25519 account addresses (`G...`) whose classic account or trustline state is read during simulation, verify that every referenced account exists and is funded on the standalone ledger before measurement ([Source-account effects](source-account-effects.md)).
- Remember that WeighIn simulates with recording authorization (`recording(true,true)`) and `testutils` host features; it measures resource usage under recorded auth trees and does not validate production cryptographic signatures ([Known limitations](KNOWN_LIMITATIONS.md)).

---

## 2. Avoid random seeds and non-deterministic PRNG dependencies

### Why PRNG calls fail in WeighIn simulations

WeighIn enforces strict **RPC/native parity** before accepting any benchmark result: the native helper's `transactionData` XDR, top-level `returnValue`, and charged `contractEvents` must match Soroban RPC byte-for-byte at the captured ledger.

The native simulation helper replays each snapshot using a **fixed 32-byte zero seed (`[0; 32]`)**, whereas Soroban RPC initializes its own PRNG state. As demonstrated in the [bounded random-contract parity proof](random-contract.md), calling `env.prng()` on a path that changes the return value, emitted events, or storage writes causes RPC and native replay to diverge—and `measureInvocation` fails closed with:

```text
auth/random/state-dependent invocation is unsupported
```

WeighIn deliberately refuses to alter the seed, suppress parity checks, or blend mismatched RPC and native numbers to force a passing result.

Even if a PRNG value were somehow hidden from the return value, random control-flow branching, variable iteration counts, or random storage keys still cause non-deterministic CPU, memory, and footprint noise across runs.

### How to keep fixtures and contracts deterministic

| Anti-pattern | Deterministic replacement |
|---|---|
| Calling `env.prng().gen()` inside a benchmarked entrypoint | Factor deterministic computation into a function that accepts explicit seed/value arguments and benchmark that entrypoint. |
| Generating fixture arguments dynamically with `Math.random()`, `Date.now()`, or `crypto.randomBytes()` | Commit static, version-controlled `weighin-fixtures.json` files with fixed literal values. |
| Generating fresh random Ed25519 keys in a fixture generator on every run | Use fixed, public, disposable test keys committed strictly for standalone local networks (never mainnet/testnet secrets). |
| Hashing current ledger timestamps or sequence numbers to derive storage keys | Derive keys from deterministic fixture arguments or fixed constants so storage footprint and key order stay identical. |

### Pattern: separate randomness from metered core logic

If your production contract relies on `env.prng()` (for example, randomized selection, shuffling, or nonce generation), separate entropy acquisition from the deterministic state transition:

```rust
// Production entrypoint: draws randomness and delegates
pub fn draw_winner(env: Env, participants: Vec<Address>) -> Address {
    let index = env.prng().gen_range::<u64>(0..participants.len() as u64) as u32;
    Self::select_winner_by_index(env, participants, index)
}

// Deterministic core logic: benchmark this entrypoint in weighin-fixtures.json
pub fn select_winner_by_index(env: Env, participants: Vec<Address>, index: u32) -> Address {
    let winner = participants.get(index).unwrap();
    env.storage().persistent().set(&symbol_short!("winner"), &winner);
    winner
}
```

If a contract also exposes PRNG-dependent entrypoints, keep a **deterministic control invocation** in the same fixture suite so build, deployment, and snapshot health remain verifiable independently of the PRNG path (see [Bounded random-contract parity proof](random-contract.md)).

---

## 3. Test realistic payload sizes and storage footprints

Benchmarking only minimal "hello world" arguments exercises baseline host dispatch overhead (~260k–300k CPU instructions) while hiding algorithmic scaling, XDR serialization cost, memory pressure, and footprint growth.

### Build a tiered workload matrix

For every critical contract entrypoint, declare multiple invocations with **explicit, stable `id`s** representing distinct workload sizes:

| Tier | Goal | Example case IDs |
|---|---|---|
| **Baseline / minimal** | Isolate fixed dispatch and setup overhead | `single-entry`, `empty-batch`, `one-hop` |
| **Typical production** | Reflect median real-world transaction payloads | `batch-8`, `two-hop-swap`, `typical-order` |
| **Worst-case / boundary** | Stress loops, memory limits, footprint caps, and event sizes near protocol bounds | `batch-32`, `max-route`, `large-payload-16kb` |

Example fixture using explicit IDs, realistic vector and byte payloads, and string-encoded 128-bit integers (see also [`examples/large-storage-fixture.json`](../examples/large-storage-fixture.json)):

```json
{
  "id": "vault-workloads",
  "contracts": [
    {
      "id": "vault",
      "wasm_path": "contract/target/wasm32v1-none/release/vault.wasm",
      "invocations": [
        {
          "id": "batch-1-entry",
          "function_name": "settle_batch",
          "args": [
            {
              "type": "vec",
              "value": [
                { "type": "u32", "value": 0 }
              ]
            },
            { "type": "i128", "value": "1000000000" },
            { "type": "bytes", "value": "0102030405060708" }
          ]
        },
        {
          "id": "batch-16-entries",
          "function_name": "settle_batch",
          "args": [
            {
              "type": "vec",
              "value": [
                { "type": "u32", "value": 0 },
                { "type": "u32", "value": 1 },
                { "type": "u32", "value": 2 },
                { "type": "u32", "value": 3 },
                { "type": "u32", "value": 4 },
                { "type": "u32", "value": 5 },
                { "type": "u32", "value": 6 },
                { "type": "u32", "value": 7 },
                { "type": "u32", "value": 8 },
                { "type": "u32", "value": 9 },
                { "type": "u32", "value": 10 },
                { "type": "u32", "value": 11 },
                { "type": "u32", "value": 12 },
                { "type": "u32", "value": 13 },
                { "type": "u32", "value": 14 },
                { "type": "u32", "value": 15 }
              ]
            },
            { "type": "i128", "value": "16000000000" },
            {
              "type": "bytes",
              "value": "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
            }
          ]
        }
      ]
    }
  ]
}
```

### Account for Soroban's actual resource-metering semantics

Design payload fixtures with each WeighIn metric's real protocol-28 definition in mind (see [WeighIn metrics](METRICS.md) and [Metric provenance](metric-provenance.md)):

- **Distinct footprint keys (`ledger_read_entries`, `ledger_write_entries`):** These count *unique* keys in the transaction footprint, not repeated host calls to the same key. Reading the same key 16 times adds CPU cost but only 1 footprint entry; to test footprint scaling, access 16 distinct keys (as in [`examples/large-storage-fixture.json`](../examples/large-storage-fixture.json)).
- **Live Soroban reads vs. classic disk reads (`ledger_read_bytes`):** Under protocol 28, live Soroban contract storage entries are metered as in-memory reads and report `0` for `ledger_read_bytes` (`diskReadBytes`). Classic ledger entries—such as Stellar accounts and trustlines accessed via a Stellar Asset Contract—incur nonzero `ledger_read_bytes`. If your protocol interacts with SACs or classic accounts, include a funded SAC case rather than relying solely on contract-data reads.
- **Write postimages (`ledger_write_bytes`):** Counts the total encoded XDR size of read-write postimages. Overwriting an existing key with the same value (a no-op write) still charges postimage bytes; deleting a key adds a `ledger_write_entries` footprint slot with `0` postimage bytes. Seed and overwrite realistic struct/map sizes rather than single `u32` flags.
- **Events and return values (`events_count`, `event_data_bytes`):** `event_data_bytes` sums encoded non-diagnostic `ContractEvent` XDR bytes **plus** the top-level return `ScVal` XDR bytes (including XDR framing and padding). Exercise realistic event emission counts and realistic return collection sizes.
- **Nested cross-contract calls and authorization trees:** Soroban charges the combined footprint, events, CPU, and memory of a nested call chain to the single top-level transaction ([Cross-contract nested invocation attribution proof](nested-invocation.md)). Include multi-contract fixtures with `depends_on` and typed `binding` arguments (see [`examples/auth-tree-fixture.json`](../examples/auth-tree-fixture.json)) when production flows cross contract boundaries.

### Follow strict fixture argument encoding rules

WeighIn validates all fixture declarations against [`docs/schemas/weighin-fixtures.schema.json`](schemas/weighin-fixtures.schema.json) and rejects unknown fields or invalid encodings before any RPC work:

- Supported argument `type`s: `symbol`, `string`, `bool`, `u32`, `i32`, `u64`, `i64`, `u128`, `i128`, `address`, `bytes`, `vec`, `map`.
- **Encode `u64`, `i64`, `u128`, and `i128` as decimal strings** (for example, `{"type": "i128", "value": "1000000000000000000"}`), never JSON numbers, to avoid IEEE-754 precision loss.
- **Encode `bytes` as lowercase hex strings** with deterministic contents.
- **Keep `vec` and `map` entries in fixed canonical order**; map entries use `{"key": ..., "value": ...}` typed descriptors.
- Avoid synthetic huge fixtures that exceed protocol-28 transaction limits and trap simulation—verify every payload tier locally with `node dist/cli.js` before committing.

---

## 4. Tips for reproducible Soroban contract simulations

In the [clean-build and live measurement repeatability experiment](repeatability.md), five independent clean builds and 35 live measurements across seven cases achieved **zero range and zero standard deviation** on all eight measured metrics while ledgers advanced from 833 to 1101. Achieving that same stability in your own repository requires controlling build inputs, identities, and execution environments.

### Pin the entire build and simulation stack

Keep every component in the measurement chain explicitly pinned and identical between BASE and HEAD:

| Component | Verified WeighIn scope | Why pinning matters |
|---|---|---|
| **Runner OS / arch** | Linux x64 (`ubuntu-24.04` / `ubuntu-22.04`) | Native helper requires Linux x64; validated zero drift across both runner images ([Runner stability](runner-stability.md)). |
| **Rust toolchain** | `1.95.0` with `wasm32v1-none` | Compiler version changes alter LLVM codegen, WASM size, and metered CPU/memory. Pin via `rust-toolchain.toml`. |
| **Stellar CLI** | `28.1.0` (SHA-256 verified archive) | Performs target selection, spec shaking, metadata injection, and WASM optimization ([Contract build path](contract-build.md)). |
| **Contract dependencies** | `Cargo.lock` committed (`--locked`) | Unpinned Soroban SDK or crate patch updates change compiled WASM instructions. |
| **Native helper** | `soroban-simulation` / `soroban-env-host` `28.0.1` | WeighIn binds helper identity by SHA-256 and rejects mismatched helper/calibration comparisons. |
| **Standalone network** | Pinned protocol-28 Quickstart image by `@sha256:...` digest | Network protocol upgrades or cost-model parameter changes invalidate BASE/HEAD comparisons. |

### Use WeighIn's default contract build path and clean compiler flags

- **Prefer the default builder over `build-command` or `skip-build`:** WeighIn's default path runs `stellar contract build --manifest-path <manifest> --package <package> --locked --optimize=true --out-dir <fresh-temp-dir>`, checks that optimization was not skipped, verifies WASM binary headers, and probes temporary storage health before and after compilation ([Contract build path](contract-build.md)). Custom `build-command` and `skip-build: true` bypass those safeguards.
- **Leave `RUSTFLAGS` and `CARGO_ENCODED_RUSTFLAGS` unset:** Even setting an empty `RUSTFLAGS=""` disables Stellar CLI's dependency-path remapping and can produce different WASM bytes across directories ([Repeatability](repeatability.md#what-is-held-constant)).
- **Keep cross-target substitution disabled:** Do not pass `--allow-cross-target-substitution` or `allow-cross-target-substitution: true`; always build and declare `wasm32v1-none` artifacts consistently.
- **Keep HEAD clean:** The GitHub Action refuses to run when tracked files have uncommitted edits, ensuring reported metrics correspond strictly to the recorded Git revision.

### Use explicit, stable logical identities

WeighIn pairs BASE and HEAD benchmarks by the structured tuple `(fixture_id, logical_id, function_name, case_id)`—never by runtime `contract_id`, WASM SHA-256, or JSON array index ([Comparison identity](comparison-identity.md)).

- Always declare explicit `id` fields on the **fixture document**, every **contract**, and every **invocation**.
- Commit fixtures with stable IDs to `BASE` before expecting PR comparisons to match.
- When renaming WASM paths or refactoring fixture files, follow a [two-step fixture migration](fixture-migration.md) rather than changing paths and IDs in a single commit.

### Verify multi-sample repeatability before tightening thresholds

Before enabling `strict_zero_tolerance` or tight percentage rules in `weighin.toml`:

1. Run your fixture suite multiple times locally against a fresh standalone network using the CLI:

   ```bash
   bash scripts/start-local-network.sh
   stellar contract build --manifest-path contract/Cargo.toml --locked --optimize=true
   for i in 1 2 3; do
     node dist/cli.js weighin-fixtures.json \
       --rpc-url http://localhost:8000/rpc \
       --output "/tmp/weighin-run-${i}.json"
   done
   ```

2. Compare all eight measured metrics across the runs. Confirm that `min == max` (zero drift) for every case.
3. Treat **both increases and decreases** on an unchanged contract as non-determinism—an unexplained decrease is still measurement noise.
4. When a delta appears unexpectedly, inspect the emitted `provenance` block (`snapshot_ledger`, `compute_config_sha256`, `resource_limits_sha256`, `helper_sha256`, `source_account`, `seed`, `auth_mode`, and `wasm_sha256`) to separate genuine code changes from ledger, environment, or build-input drift.
5. Never interpret the three unavailable metrics (`historical_data_read_bytes`, `contract_data_hard_limit`, `tx_size_bytes`) as `0`; they emit `null` with an explicit reason and must be handled explicitly in policies.

### Isolate local and CI network sidecars

- Run each CI job against its own dedicated local Quickstart container on an isolated port; do not point concurrent benchmark jobs at a shared mutable RPC endpoint ([Standalone network and deployer readiness](network-readiness.md)).
- Always wait for `getHealth` (`"status": "healthy"`), verify `getNetwork` (protocol 28 and standalone passphrase), and confirm Friendbot availability before running benchmarks ([Troubleshooting](TROUBLESHOOTING.md)).
- Stop and discard disposable Quickstart containers after each local experiment so stale state never leaks into subsequent runs.

---

## 5. Pre-merge fixture checklist

Before committing new or updated Soroban benchmark fixtures:

- [ ] Every fixture file, contract, and invocation has an explicit, stable `id` (and already exists in BASE if this PR expects a matched comparison).
- [ ] All contract state required by benchmarks is initialized deterministically in `__constructor` or repeatable setup against a fresh standalone network; no measured invocation depends on writes from an earlier measured invocation.
- [ ] Cross-contract calls declare `depends_on` and use typed `binding` arguments instead of hardcoded `C...` contract addresses.
- [ ] Benchmarked paths do not branch or loop unpredictably on `env.ledger().sequence()` or `env.ledger().timestamp()`.
- [ ] Benchmarked paths do not call `env.prng()`; all inputs are static, committed literals (with `u64`/`i64`/`u128`/`i128` encoded as strings).
- [ ] Payload sizes cover realistic tiers (baseline, typical, and worst-case) across CPU, memory, distinct footprint entries, write postimages, events, and return values.
- [ ] Toolchain (`rust-toolchain.toml`, Stellar CLI, `Cargo.lock`) and Quickstart Docker image digest are pinned, and `RUSTFLAGS` / `CARGO_ENCODED_RUSTFLAGS` are unset.
- [ ] Repeated local runs on the same revision produce zero variance across all eight measured metrics.

---

## Further reading

- [Soroban resource budgeting best practices](BEST-PRACTICES.md)
- [WeighIn metrics and Soroban resource fees](METRICS.md)
- [Fixture JSON Schema](fixture-schema.md)
- [Comparison identity](comparison-identity.md)
- [Fixture setup plan and typed setup bindings](setup-plan.md)
- [Two-step fixture migration](fixture-migration.md)
- [Clean-build and live measurement repeatability](repeatability.md)
- [Controlled ledger-dependent variation proof](ledger-variation.md)
- [Bounded random-contract parity proof](random-contract.md)
- [Temporary-entry TTL proof](temporary-ttl.md)
- [Source-account effects](source-account-effects.md)
- [Cross-contract nested invocation attribution proof](nested-invocation.md)
- [Funded standard token transfer](token-transfer.md)
- [Hosted runner stability validation](runner-stability.md)
- [Contract build path](contract-build.md)
- [Native simulation measurement](native-measurement.md)
- [Standalone network and deployer readiness](network-readiness.md)
- [WeighIn troubleshooting](TROUBLESHOOTING.md)
- [Known limitations](KNOWN_LIMITATIONS.md)
- [Soroban simulation fixtures](../examples/README.md)
