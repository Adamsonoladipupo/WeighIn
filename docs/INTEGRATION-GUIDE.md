
# Integrating WeighIn into an Existing Soroban Project

This guide explains how to integrate WeighIn into an existing Soroban smart
contract repository.

By the end of this walkthrough, your repository will have:

- A fixture declaration file describing the contracts and functions to measure.
- A `weighin.toml` policy configuration.
- A local measurement workflow.
- A GitHub Actions producer workflow.
- A separate secure PR-comment workflow.

WeighIn compares resource consumption between BASE and HEAD revisions and
reports increases in Soroban contract resource usage.

## Prerequisites

Before integrating WeighIn, ensure you have:

- An existing Soroban smart contract repository.
- Git and GitHub access.
- Node.js and npm.
- Rust and Cargo.
- A compatible Stellar CLI.
- Docker.
- A Linux x64 GitHub Actions runner for the verified native measurement path.
- A Soroban contract that can be built and invoked successfully.

The currently verified measurement scope uses:

| Component | Tested version |
|---|---|
| Node.js | Node 24 for the GitHub Action |
| Rust | 1.95.0 |
| Stellar CLI | 28.1.0 |
| Soroban SDK | 28.0.0 |
| Stellar protocol | 28 |
| Runner | Linux x64 |

Consult the repository's current compatibility and evidence documents before
changing these versions.

## Step 1: Build Your Soroban Contract

From the root of your existing Soroban repository, build the contract:

```bash
stellar contract build --locked --optimize=true
```

The default WeighIn builder uses the `wasm32v1-none` target.

For example, your generated WASM file might be:

```text
contract/target/wasm32v1-none/release/contract_test.wasm
```

The actual filename depends on your Cargo package name.

Verify that the generated WASM artifact exists before continuing.

The GitHub Action normally builds BASE and HEAD independently. This local
build is useful for preparing and testing the fixture declarations.

## Step 2: Create weighin-fixtures.json

Create the following file in the root of your repository:

```text
weighin-fixtures.json
```

This file declares the contract WASM files and the functions that WeighIn
should invoke.

Example:

```json
{
  "id": "my-contract-suite",
  "contracts": [
    {
      "id": "hello-contract",
      "wasm_path": "contract/target/wasm32v1-none/release/contract_test.wasm",
      "invocations": [
        {
          "id": "hello-world",
          "function_name": "hello",
          "args": [
            {
              "type": "symbol",
              "value": "world"
            }
          ]
        }
      ]
    }
  ]
}
```

### Understanding the Fixture Fields

| Field | Description |
|---|---|
| `id` | Optional stable identity for the fixture suite |
| `contracts` | Contracts to deploy and measure |
| `id` inside a contract | Optional stable contract identity |
| `wasm_path` | Relative path to the contract WASM artifact |
| `depends_on` | Optional IDs of prerequisite contracts |
| `invocations` | Functions and argument combinations to measure |
| `function_name` | Exported Soroban contract function |
| `args` | Typed arguments passed to the function |
| Invocation `id` | Optional stable identity for the benchmark case |

The fixture path is resolved relative to the fixture file.

### Supported Invocation Argument Types

The fixture validator supports:

- `symbol`
- `string`
- `u32`
- `i32`
- `bool`
- `u64`
- `i64`
- `u128`
- `i128`
- `address`
- `bytes`
- `vec`
- `map`

Large integer arguments must be supplied as strings to preserve precision.

For example:

```json
{
  "type": "i128",
  "value": "1000000"
}
```

Do not replace the example function or argument with arbitrary values.
The function and its arguments must match the actual contract interface.

### Stable Benchmark Identity

Where possible, give your fixtures, contracts, and invocations explicit IDs.

For example:

```json
{
  "id": "payment-suite",
  "contracts": [
    {
      "id": "token-contract",
      "wasm_path": "contract/target/wasm32v1-none/release/token.wasm",
      "invocations": [
        {
          "id": "transfer-one",
          "function_name": "transfer",
          "args": []
        }
      ]
    }
  ]
}
```

The example above illustrates identity fields; replace the empty argument
array with arguments required by your actual function.

Explicit IDs help WeighIn identify the same logical benchmark across
different contract revisions.

## Step 3: Create weighin.toml

Create the configuration file in your repository root:

```text
weighin.toml
```

Start with a permissive configuration:

```toml
# Initial WeighIn configuration.
# Establish a reliable BASE/HEAD benchmark before tightening policies.

[thresholds.global]
fail_on_any_regression = false
```

This configuration allows you to establish baseline measurements without
enforcing strict regression rules.

Once you have reviewed your benchmark results, introduce targeted rules.

For example:

```toml
[thresholds.functions.hello]
cpu_instructions = "allow_5_percent_increase"
memory_bytes = "allow_10_percent_increase"
ledger_write_bytes = "strict_zero_tolerance"
```

The function name must match the function declared in your fixture file.

See [Configuration Reference](CONFIGURATION.md) for all supported metrics,
rules, global settings, absolute limits, and aggregate budgets.

## Step 4: Test Locally

Before pushing your changes, test your contract and WeighIn configuration
locally.

### 4.1 Start Stellar Quickstart

Start a local standalone Stellar network:

```bash
docker run --rm -d \
  --name stellar-quickstart \
  -p 8000:8000 \
  stellar/quickstart:latest --local
```

Wait until the RPC health endpoint reports that the network is healthy:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  http://localhost:8000/rpc
```

For reproducible local and CI environments, use the reviewed image digest
from your project's workflow.

### 4.2 Install WeighIn

Install the published CLI:

```bash
npm install -g weighin
```

Alternatively, use:

```bash
npx weighin --help
```

### 4.3 Run a Local Measurement

Ensure that your contract WASM exists and your fixture file is valid.

Run:

```bash
weighin weighin-fixtures.json \
  --rpc-url http://localhost:8000/rpc \
  --output weighin-results.json
```

Inspect the results:

```bash
cat weighin-results.json
```

A successful CLI measurement confirms that the declared fixture can be
measured against your local RPC environment.

**Important:** The standalone CLI does not build your contracts, compare
BASE against HEAD, or enforce the complete pull request regression policy.
Those operations are performed by the GitHub Action.

### 4.4 Stop Stellar Quickstart

```bash
docker stop stellar-quickstart
```

## Step 5: Add the Producer Workflow

Create:

```text
.github/workflows/weighin.yml
```

This workflow runs when a pull request is opened or updated.

It checks out the repository, provisions the required toolchain and local
Stellar network, executes WeighIn, and uploads the resulting artifacts.

The following is a minimal producer workflow template. It deliberately
separates the action version from the example so you can pin a reviewed
immutable commit.

Replace `<REVIEWED_COMMIT_SHA>` with the same verified WeighIn commit SHA
used by the comment workflow.

```yaml
name: WeighIn Benchmark

on:
  pull_request:
    branches:
      - main

permissions:
  contents: read

jobs:
  benchmark:
    name: Soroban Resource Benchmark
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@d1031067263f94b142dd6c0ce24c5eb9d02d52a0
        with:
          toolchain: "1.95.0"
          targets: wasm32v1-none

      - name: Install pinned Stellar CLI
        run: |
          curl -fsSL \
            https://github.com/stellar/stellar-cli/releases/download/v28.1.0/stellar-cli-28.1.0-x86_64-unknown-linux-gnu.tar.gz \
            -o "$RUNNER_TEMP/stellar-cli.tar.gz"

          echo "c1680deee94301d33ada7a17f98411e642a4248c727afbd2e43050d345746462  $RUNNER_TEMP/stellar-cli.tar.gz" \
            | sha256sum -c -

          mkdir -p "$RUNNER_TEMP/stellar-cli"

          tar -xzf "$RUNNER_TEMP/stellar-cli.tar.gz" \
            -C "$RUNNER_TEMP/stellar-cli"

          echo "$RUNNER_TEMP/stellar-cli" >> "$GITHUB_PATH"

      - name: Start local Stellar network
        run: |
          docker run --rm -d \
            --name stellar-quickstart \
            -p 8000:8000 \
            stellar/quickstart@sha256:4c8bad1ef7341205b898f83d9489321da80c7bd74183100fc8e2a39a5938c7d5 \
            --local

          echo "Waiting for RPC health..."

          for i in $(seq 1 60); do
            if curl -sf -X POST \
              -H "Content-Type: application/json" \
              -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
              http://localhost:8000/rpc \
              | grep -q '"status":"healthy"'; then
                echo "RPC is healthy."
                exit 0
            fi

            sleep 2
          done

          echo "RPC failed to become healthy." >&2
          docker logs stellar-quickstart || true
          exit 1

      - name: Run WeighIn
        uses: WeighInNG/WeighIn@<REVIEWED_COMMIT_SHA>
        with:
          fixtures-path: weighin-fixtures.json
          config-path: weighin.toml
          rpc-url: http://localhost:8000/rpc
          report-path: weighin-report.md
          metadata-path: pr-metadata.json

      - name: Upload WeighIn artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: weighin-artifacts
          path: |
            weighin-report.md
            pr-metadata.json
          if-no-files-found: ignore
```

### Why fetch-depth: 0 is used

WeighIn needs Git history and the ability to fetch the BASE reference.

The Action uses the existing checkout and creates a separate detached BASE
worktree. Avoid shallow checkout configurations that prevent the required
revision from being fetched.

### Why the artifact upload uses if: always()

A policy violation can cause the WeighIn Action to fail.

The report and metadata should still be uploaded when available so that
developers can inspect the measurement results.

The separate comment workflow is intentionally configured to run only
after a successful producer workflow. A failed policy report remains
available in the producer artifacts and job summary.

## Step 6: Add the Separate Comment Workflow

Create:

```text
.github/workflows/weighin-comment.yml
```

This workflow receives the producer's completed run, downloads its artifacts,
validates the report and metadata, and publishes the benchmark comment.

```yaml
name: WeighIn Comment

on:
  workflow_run:
    workflows:
      - WeighIn Benchmark
    types:
      - completed

permissions:
  contents: read
  actions: read
  pull-requests: write

jobs:
  post-comment:
    name: Post PR Comment
    runs-on: ubuntu-latest

    if: >
      github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.event == 'pull_request'

    steps:
      - name: Download WeighIn artifacts
        uses: actions/download-artifact@v4
        with:
          name: weighin-artifacts
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Post benchmark comment
        uses: WeighInNG/WeighIn/comment@<REVIEWED_COMMIT_SHA>
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          report-path: weighin-report.md
          metadata-path: pr-metadata.json
```

Use exactly the same reviewed immutable commit SHA for the producer and
consumer. Their metadata formats and freshness checks must be compatible.

### Why the Comment Workflow Is Separate

A pull request can come from a fork.

Fork contributions are untrusted input. They should not receive a GitHub
token with permission to write comments or modify repository resources.

The producer workflow:

- Runs the benchmark.
- Uses read-only repository permissions.
- Produces report and metadata artifacts.
- Does not need pull request write permissions.

The comment workflow:

- Runs from trusted base-repository workflow code.
- Downloads the producer artifacts.
- Does not check out or execute pull request code.
- Validates the metadata and report.
- Checks that the report is not stale.
- Uses a write-enabled token only for the commenting operation.

Do not combine the producer and comment operations into one privileged
workflow that executes untrusted pull request code.

## Step 7: Commit the Baseline Configuration

Before relying on regression comparisons, ensure that the BASE revision
contains the fixture declarations required for the comparison.

The fixture file must exist in both BASE and HEAD.

A recommended rollout is:

1. Add `weighin-fixtures.json`.
2. Add a permissive `weighin.toml`.
3. Add the producer and comment workflows.
4. Merge the initial integration into your default branch.
5. Allow the first comparison to establish a baseline.
6. Review benchmark measurements.
7. Gradually introduce strict thresholds and absolute limits.

WeighIn uses logical fixture, contract, and invocation identities to pair
benchmark cases across revisions.

Stable explicit IDs are recommended when contract paths or WASM filenames
may change.

## Step 8: Verify the Integration

After pushing your changes, open a pull request and verify the following.

### Producer workflow

- [ ] The workflow starts on a pull request.
- [ ] The Rust toolchain installs successfully.
- [ ] The Stellar CLI installs successfully.
- [ ] Stellar Quickstart reports a healthy RPC endpoint.
- [ ] HEAD contracts build successfully.
- [ ] BASE contracts build successfully.
- [ ] Both revisions are measured.
- [ ] BASE/HEAD differences are generated.
- [ ] Threshold policies are evaluated.
- [ ] The Markdown report is generated.
- [ ] PR metadata is generated when applicable.
- [ ] Artifacts are uploaded.

### Comment workflow

- [ ] The workflow starts after a successful producer run.
- [ ] The producer artifact is downloaded.
- [ ] The report passes validation.
- [ ] The PR metadata passes validation.
- [ ] Report freshness is verified.
- [ ] The benchmark comment is created or updated.

### Security verification

- [ ] The producer has no pull request write permission.
- [ ] The comment workflow runs trusted base-repository code.
- [ ] Downloaded artifacts are treated as untrusted data.
- [ ] The comment workflow does not execute pull request code.
- [ ] Producer and consumer use compatible immutable versions.

## Troubleshooting

### BASE fixture file not found

Ensure the fixture file has been committed to the default branch or selected
BASE revision.

### No matched BASE/HEAD benchmarks

Ensure that the same logical benchmark identities exist in both revisions.

Explicit fixture, contract, and invocation IDs help preserve identity.

### RPC is incompatible

Check that your Quickstart image, protocol version, and network passphrase
match the supported WeighIn environment.

### Native helper fails

Verify the runner architecture and the native helper toolchain requirements.

### Threshold evaluation fails

Review `weighin.toml`, confirm the function names, and ensure that required
metrics are available.

### Comment workflow does not run

Check the producer workflow conclusion and the `workflow_run` event filter.

The supplied consumer example posts comments only after successful producer
runs.

### Artifact download fails

Confirm that the artifact name, run ID, permissions, and producer upload
configuration match between the two workflows.

## Further Documentation

- [Architecture](ARCHITECTURE.md)
- [CLI Usage](CLI.md)
- [Configuration Reference](CONFIGURATION.md)
- [Metric Provenance](metric-provenance.md)
- [Contract Build](contract-build.md)
- [Native Measurement](native-measurement.md)
- [Known Limitations](KNOWN_LIMITATIONS.md)
