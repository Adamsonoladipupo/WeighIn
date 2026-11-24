# WeighIn Doctor Command

The `weighin doctor` command inspects the local environment and reports whether
the prerequisites for running WeighIn benchmarks are present.

It is a read-only diagnostic tool. It never installs tools, deploys contracts,
submits transactions, creates accounts, modifies project configuration, or
leaves any persistent changes on disk.

## Purpose

WeighIn requires a specific set of tools, a supported platform, a compatible
Stellar network, and a build environment that includes the `wasm32v1-none` Rust
target. When something is missing or misconfigured, the error messages from the
main benchmark workflow can be hard to interpret without context.

The doctor command checks every prerequisite in one pass and reports a clear
status for each, together with an actionable remediation when something is
wrong. Run it before provisioning a CI environment, troubleshooting a local
setup, or verifying that an existing installation still meets requirements.

## Usage

```bash
weighin doctor
```

Optionally probe a specific RPC endpoint:

```bash
weighin doctor --rpc-url http://localhost:8000/rpc
```

## Options

| Option | Description | Default |
|---|---|---|
| `--rpc-url <url>` | Stellar RPC endpoint to probe for health and network metadata | `http://localhost:8000/rpc` |
| `--help`, `-h` | Display main CLI help | — |

When `--rpc-url` is omitted, the RPC checks are skipped and only the local
environment checks run.

## Diagnostic Checks

The command runs the following checks in order.

### Host platform

Verifies that the host OS and architecture are Linux x64. Native simulation
currently supports Linux x64 only. Other platforms and architectures report a
failure with a clear message rather than producing incorrect measurements.

### Node.js

Verifies that the installed Node.js version is at least Node 20. The GitHub
Action runtime targets Node 24.

### stellar CLI

Checks that `stellar` is on the PATH and is version 28.1.0 or later. The
default contract builder invokes `stellar contract build --locked
--optimize=true` with the `wasm32v1-none` target, and requires a version that
includes optimization support.

If the binary is absent, the check reports `fail` with installation
instructions. If the version is too old, the check reports `fail` with the
minimum required version.

### rustc

Checks that `rustc` is on the PATH and is version 1.84.0 or later. Rust 1.84+
is required to compile contracts for the `wasm32v1-none` target.

### cargo

Checks that `cargo` is on the PATH. Cargo is included with a standard Rust
installation via rustup. The simulation helper build invokes `cargo +1.95.0
build --release --locked`.

### docker

Checks that the Docker CLI is on the PATH and that the Docker daemon is
reachable. Docker is required to run a local Stellar standalone network via
the `stellar/quickstart` image.

The check distinguishes between the Docker CLI being absent and the Docker
daemon being unavailable, and provides separate remediation for each case.

### build target (wasm32v1-none)

Runs `rustup target list --installed` and verifies that `wasm32v1-none` is
present. This is the Rust target used for Soroban contract compilation.

If `rustup` itself is unavailable, the check reports `unknown` rather than
`pass`.

### native simulation helper sources

Verifies that the native simulation helper sources ship with the installed
WeighIn package. The expected files are:

- `native/simulation/Cargo.toml`
- `native/simulation/Cargo.lock`
- `native/simulation/src/main.rs`

If any are missing, the package is likely corrupted or incompletely installed.

### native simulation helper (built)

Checks for a compiled helper binary at the expected output path:

```text
native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation
```

The check also accepts a path from the `WEIGHIN_HELPER_PATH` environment
variable.

If no built binary is found, the check reports `unknown` (not `fail`) because
the binary is built on demand. It includes instructions for building it
explicitly with `npm run build:helper`, and for supplying an existing
compatible binary via `WEIGHIN_HELPER_PATH` or `--helper-path`.

### temporary storage (TMPDIR)

Probes the temporary directory (from `os.tmpdir()`, which respects the `TMPDIR`
environment variable on Unix) by writing and immediately deleting a small file.
No persistent file is left.

If the probe fails, the check reports `fail` with guidance to set `TMPDIR` to
a writable path. The contract builder and build storage verification both
require writable temporary storage.

### RPC endpoint (health)

Only run when `--rpc-url` is provided.

Sends a `getHealth` JSON-RPC request to the configured endpoint and verifies
that the response has `"status": "healthy"`. Timeouts and connection errors
report `fail` with remediation to start the local network.

If the health check fails, the network check is skipped and reports `unknown`.

### RPC endpoint (network)

Only run when `--rpc-url` is provided and the health check passed.

Sends a `getNetwork` JSON-RPC request and verifies that:

- The network passphrase is `"Standalone Network ; February 2017"`.
- The protocol version is `28`.

A healthy endpoint with an unsupported passphrase or protocol version reports
`fail` with an explicit message rather than a generic connection failure.
WeighIn supports only the standalone network at protocol 28.

## Check Statuses

Each check reports one of three statuses.

| Status | Meaning |
|---|---|
| `✔ pass` | The requirement is present and meets the version/compatibility criteria. |
| `✖ fail` | The requirement is missing, incompatible, or the check produced an error. Remediation is included. |
| `? unknown` | The check could not be completed conclusively. This is treated as a non-pass and counts toward the failing check total. |

Unknown or unverifiable requirements are never silently reported as passing.

## Exit Codes

| Exit code | Meaning |
|---|---|
| `0` | All checks passed. |
| `1` | One or more checks failed or could not be verified. |

The exit code is 1 when any check has status `fail` or `unknown`.

## Credential Redaction

The doctor command uses the same credential redaction as the rest of the CLI.
Credentials in `--rpc-url` values, including usernames, passwords, and
sensitive query parameters, are stripped from all diagnostic output. The
display form uses only the scheme, host, port, and path; query values are
replaced with `REDACTED`; and the fragment is dropped. A malformed URL is
replaced with `[invalid endpoint]`. Requests always use the original
unmodified URL.

This is shape-based redaction for display only. It does not prove that an
endpoint URL is secret-free or that credentials are not embedded in the path
segment.

## Read-Only Guarantees

The doctor command makes no persistent changes. Specifically, it does not:

- Install any tools or dependencies.
- Deploy contracts or submit transactions.
- Create or fund accounts.
- Build or regenerate artifacts.
- Modify project configuration.
- Change persistent network or application state.

Storage writability is verified by creating and immediately deleting a small
temporary file. The file is removed in a `finally` block even if the write
fails. No other files are written.

The doctor command does not bypass or replace any existing runtime validation.
It is a pre-flight check that complements but does not substitute for the
validations performed during actual benchmark runs.

## Examples

### Check local prerequisites without probing the network

```bash
weighin doctor
```

Example output when prerequisites are met:

```text
WeighIn environment diagnostics

  ✔ Host platform: linux/x64
  ✔ Node.js: v24.0.0
  ✔ stellar CLI: stellar 28.1.0 (c3e1234)
  ✔ rustc: rustc 1.95.0 (1234567 2025-01-01)
  ✔ cargo: cargo 1.95.0 (abcdef 2025-01-01)
  ✔ docker: Docker version 27.0.0, build abc1234; server 27.0.0
  ✔ build target (wasm32v1-none): wasm32v1-none installed
  ✔ native simulation helper sources: present (/path/to/native/simulation)
  ✔ native simulation helper (built): /path/to/weighin-simulation
  ✔ temporary storage (TMPDIR): /tmp

All checks passed.
```

### Check local prerequisites and probe a local RPC endpoint

```bash
weighin doctor --rpc-url http://localhost:8000/rpc
```

### Diagnose a missing Rust target

If the `wasm32v1-none` target is not installed, the output includes:

```text
  ✖ build target (wasm32v1-none): wasm32v1-none not installed
      Add the required Rust target: rustup target add wasm32v1-none
```

Install the target:

```bash
rustup target add wasm32v1-none
```

### Diagnose a missing Stellar CLI

```text
  ✖ stellar CLI: not found
      Install Stellar CLI 28.1.0 from https://github.com/stellar/stellar-cli/releases.
      The default contract builder requires `stellar contract build --locked --optimize=true`.
```

### Diagnose an unbuilt helper

```text
  ? native simulation helper (built): not yet built
      Build the helper with: npm run build:helper
      Or provide an existing binary via WEIGHIN_HELPER_PATH or --helper-path.
```

Build the helper:

```bash
npm run build:helper
```

### Diagnose an incompatible RPC endpoint

```text
  ✖ RPC endpoint (network): http://localhost:8000/rpc — unsupported passphrase: "Public Global Stellar Network ; September 2015"
      WeighIn supports only the standalone network (passphrase: "Standalone Network ; February 2017").
      Public Stellar network endpoints are outside the supported measurement scope.
```

## Relationship to Runtime Validation

The doctor command is a pre-flight check and does not replace runtime
validation. The main benchmark workflow and Action perform their own checks for
platform support, helper provenance, network passphrase, protocol version, RPC
health, and credential safety. Those checks remain active whether or not
`weighin doctor` is run first.

## Related Documentation

- [CLI Reference](CLI.md)
- [Native Measurement](native-measurement.md)
- [Network Readiness](network-readiness.md)
- [Contract Build](contract-build.md)
- [Known Limitations](KNOWN_LIMITATIONS.md)
- [Troubleshooting](TROUBLESHOOTING.md)
