
# WeighIn troubleshooting

This guide covers common local and CI problems when starting Stellar Quickstart, connecting to Soroban RPC, simulating transactions and resolving contract WASM paths.

The supported WeighIn measurement path documented by this repository uses a standalone protocol-28 network. A healthy RPC endpoint on another network or protocol is not automatically compatible.

For the complete readiness behaviour, see [Standalone network and deployer readiness](network-readiness.md).

## 1. Docker port 8000 is already in use

### Symptoms

You may see an error similar to:

```text
Bind for 0.0.0.0:8000 failed: port is already allocated
```

This means another process or container is already using host port `8000`.

### Diagnose

Check running containers and their published ports:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

Inspect containers that publish port 8000:

```bash
docker ps --filter "publish=8000" --format "table {{.ID}}\t{{.Names}}\t{{.Ports}}"
```

On Linux, inspect the listening process:

```bash
sudo ss -ltnp | grep ':8000'
```

If `ss` is unavailable, use:

```bash
sudo lsof -iTCP:8000 -sTCP:LISTEN
```

### Fix

If the existing container is no longer needed, stop the specific container you identified:

```bash
docker stop <container-name-or-id>
```

Do not stop or remove a container unless you have confirmed that it belongs to your current development task.

Alternatively, use another unused host port. The Quickstart container listens on port `8000` internally, so map a different host port to it:

```bash
docker run --rm -d \
  --name weighin-quickstart-alt \
  -p 18000:8000 \
  stellar/quickstart@sha256:4c8bad1ef7341205b898f83d9489321da80c7bd74183100fc8e2a39a5938c7d5 \
  --local
```

The RPC endpoint is then:

```text
http://localhost:18000/rpc
```

Pass that endpoint to WeighIn using the `rpc-url` Action input or the CLI's `--rpc-url` option.

The repository also provides a startup script that supports custom names and ports:

```bash
bash scripts/start-local-network.sh --name weighin-local-alt --port 18000
```

## 2. RPC is not ready when WeighIn starts

### Symptoms

Common errors include:

```text
Soroban RPC ... is not reachable
```

```text
RPC has not reported healthy
```

```text
RPC is healthy but incompatible
```

A running Docker container does not necessarily mean that the RPC service is ready to accept requests.

### Check container status

```bash
docker ps --filter "name=stellar-quickstart"
```

Inspect its logs:

```bash
docker logs --tail 100 stellar-quickstart
```

### Check the RPC health endpoint

WeighIn uses the JSON-RPC `getHealth` method at the `/rpc` endpoint. It does not rely on a separate `/health` route.

Run:

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  http://localhost:8000/rpc
```

A healthy response contains:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "status": "healthy"
  }
}
```

The exact response may contain additional fields.

### Wait until RPC is healthy

Use a bounded readiness loop instead of immediately invoking WeighIn:

```bash
RPC_URL="http://localhost:8000/rpc"

for attempt in $(seq 1 60); do
  if curl -fsS -X POST \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
    "$RPC_URL" |
    grep -Eq '"status"[[:space:]]*:[[:space:]]*"healthy"'; then
    echo "Soroban RPC is healthy."
    break
  fi

  if [ "$attempt" -eq 60 ]; then
    echo "RPC did not become healthy within the expected time." >&2
    docker logs --tail 200 stellar-quickstart >&2 || true
    exit 1
  fi

  sleep 2
done
```

This loop waits for up to approximately two minutes.

### Check network compatibility

A healthy response alone is not enough. WeighIn also checks the network passphrase and protocol version.

Run:

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"getNetwork"}' \
  http://localhost:8000/rpc
```

Confirm that the returned network metadata matches the standalone network and protocol version supported by the current WeighIn release.

Do not assume that a healthy testnet, mainnet or another local network is compatible.

## 3. `Transaction simulation failed: HostError`

### Symptoms

A simulation may fail with an error similar to:

```text
Transaction simulation failed: HostError
```

A HostError means that Soroban execution encountered a host-level or contract execution failure. It does not necessarily indicate an RPC outage.

### First checks

Confirm that the RPC is healthy:

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  http://localhost:8000/rpc
```

Inspect the Quickstart logs:

```bash
docker logs --tail 200 stellar-quickstart
```

Then review the fixture invocation that failed:

- Is the function name correct?
- Are all arguments using the correct Soroban value types?
- Are large integer arguments represented as strings where required?
- Does the contract require a dependency to be deployed first?
- Does the invocation use the expected address or dependency binding?
- Does the operation require authorization or ledger state that is absent from the fixture setup?
- Is the WASM artifact built for the expected target and SDK?

### Validate the fixture arguments

WeighIn supports the argument types declared in its fixture schema, including symbols, strings, booleans, integers, addresses, bytes, vectors and maps.

For `u64`, `i64`, `u128` and `i128`, use strings to preserve integer precision.

For example:

```json
{
  "type": "i128",
  "value": "1000000000000000000"
}
```

Do not use a JavaScript-style floating-point JSON number for a large integer.

### Check contract dependencies

If one contract calls another deployed contract, declare the dependency using `depends_on` and use the supported dependency address binding.

Do not assume that a previous measured invocation has committed state for the next invocation. WeighIn simulates measured invocations independently against captured ledger snapshots; writes made by one measured invocation are not committed as setup for a later case.

See the [fixture schema](fixture-schema.md) and [known limitations](KNOWN_LIMITATIONS.md) for supported setup and invocation behaviour.

### Re-run after fixing the cause

Do not treat repeated retries as a fix for a deterministic HostError. Correct the fixture, contract state, argument or authorization requirement first.

If the error occurs only intermittently, preserve the RPC response and container logs so that the failure can be distinguished from a network-readiness or ledger-state problem.

## 4. WASM file not found or path resolution fails

### Symptoms

You may see errors indicating that:

- A declared WASM file does not exist.
- A fixture points to an old target directory.
- The expected contract artifact was not produced.
- A custom Cargo target directory does not match the fixture path.

### Understand fixture path resolution

The `wasm_path` in a fixture is resolved relative to the fixture file, not automatically relative to the repository root.

For example:

```json
{
  "id": "greeting-suite",
  "contracts": [
    {
      "id": "greeting",
      "wasm_path": "contract/target/wasm32v1-none/release/contract_test.wasm",
      "invocations": [
        {
          "id": "world",
          "function_name": "hello",
          "args": []
        }
      ]
    }
  ]
}
```

If the fixture file is in the repository root, the example path resolves from that root.

### Check whether the artifact exists

From the repository root:

```bash
ls -lh contract/target/wasm32v1-none/release/
```

Search for generated WASM files:

```bash
find contract/target -type f -name '*.wasm' -print
```

### Build using the expected target

The verified reference toolchain uses Rust 1.95.0 and the `wasm32v1-none` target:

```bash
rustup target add wasm32v1-none --toolchain 1.95.0

stellar contract build \
  --manifest-path contract/Cargo.toml \
  --locked \
  --optimize=true
```

Then verify the expected artifact:

```bash
test -f contract/target/wasm32v1-none/release/contract_test.wasm \
  && echo "WASM artifact found." \
  || echo "WASM artifact is missing."
```

The exact WASM filename depends on the Cargo package or library target name. Do not assume that the filename always matches the repository directory name.

### If you use a custom Cargo target directory

Cargo supports custom target directories. If your build command writes WASM to a different directory, the fixture's `wasm_path` must point to the actual output location.

For example, if the artifact is written to:

```text
/tmp/weighin-target/wasm32v1-none/release/contract_test.wasm
```

then a fixture using the default repository target path will not find it.

You have two choices:

1. Configure the build so that it produces the artifact at the fixture's declared path.
2. Update the fixture path to the actual artifact location, while keeping it within the permitted workspace boundary.

The default WeighIn builder resolves packages and output paths from fixture declarations. For a custom build layout, use the documented `build-command` escape hatch and ensure both BASE and HEAD produce the expected artifacts.

`build-command` replaces the default build guarantees. The caller becomes responsible for artifact freshness, build flags, optimization and output correctness.

`skip-build: true` also bypasses the default build path and uses prebuilt fixture WASMs. Use it only when the artifacts are deliberately prepared for both revisions.

See [Contract build path](contract-build.md) for the builder's workspace, manifest, target and artifact validation rules.

## 5. RPC works but the benchmark still fails

A healthy RPC endpoint does not guarantee that every benchmark can run.

Check the following:

1. Confirm that the network passphrase and protocol match the supported configuration.
2. Confirm that the deployer account can be initialized and included in RPC state.
3. Confirm that the fixture WASM files exist and are valid.
4. Confirm that the contract and invocation IDs are stable across BASE and HEAD.
5. Confirm that the contract arguments and dependencies are valid.
6. Inspect the full WeighIn error and the Quickstart logs.
7. Check whether the error is a measurement mismatch rather than a transport failure.

WeighIn fails closed when required RPC/native measurement data disagree. It does not silently combine inconsistent resource measurements.

## 6. Useful diagnostic command summary

Run these commands from the machine hosting the local Quickstart container.

```bash
# List running containers and published ports.
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Inspect the Quickstart logs.
docker logs --tail 200 stellar-quickstart

# Check whether host port 8000 is listening.
sudo ss -ltnp | grep ':8000' || true

# Check RPC health.
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  http://localhost:8000/rpc

# Check network metadata.
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"getNetwork"}' \
  http://localhost:8000/rpc

# Find contract WASM artifacts.
find contract/target -type f -name '*.wasm' -print
```

## 7. Repository startup helper

The repository provides a local network startup helper:

```bash
npm ci
npm run build
bash scripts/start-local-network.sh
```

The helper starts the pinned Quickstart image, waits for RPC health and account readiness, and leaves the successfully started container running.

It supports a custom container name and host port:

```bash
bash scripts/start-local-network.sh --name weighin-local --port 18000
```

When startup fails before readiness, the helper captures logs and attempts to stop only the container it started. It does not automatically remove an unrelated container with the same name unless replacement has been explicitly authorized.

## Further reading

- [Standalone network and deployer readiness](network-readiness.md)
- [Contract build path](contract-build.md)
- [Fixture schema](fixture-schema.md)
- [Metric provenance](metric-provenance.md)
- [Known limitations](KNOWN_LIMITATIONS.md)
- [Stellar Soroban RPC documentation](https://developers.stellar.org/docs/data/apis/rpc)
