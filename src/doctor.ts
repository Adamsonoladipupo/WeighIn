/**
 * Read-only environment diagnostics for WeighIn.
 *
 * The doctor command inspects the local environment and reports whether the
 * prerequisites for running WeighIn benchmarks are present. It never installs
 * tools, deploys contracts, submits transactions, creates accounts, or modifies
 * project configuration. Storage writability is probed and cleaned up
 * immediately so no persistent changes are left.
 *
 * Credentials in RPC URLs are redacted from all output using the same shared
 * sanitizer applied elsewhere in the CLI.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { sanitizeEndpoint, redactEndpointSecrets } from "./endpoint";
import {
  SUPPORTED_NETWORK_PASSPHRASE,
  SUPPORTED_PROTOCOL_VERSION,
} from "./network";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CheckStatus = "pass" | "fail" | "unknown";

export interface DiagnosticCheck {
  /** Short human-readable name, e.g. "stellar CLI". */
  name: string;
  status: CheckStatus;
  /** One-line detail shown next to the status, e.g. a version string. */
  detail: string;
  /** Actionable remediation when status is "fail" or "unknown". */
  remediation?: string;
}

export interface DoctorReport {
  checks: DiagnosticCheck[];
  /** true when every check passed. */
  healthy: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Version requirements sourced from build.ts and native-measurement.md. */
export const REQUIRED_STELLAR_MAJOR = 28;
export const REQUIRED_STELLAR_MINOR = 1;
export const REQUIRED_RUST_MAJOR = 1;
export const REQUIRED_RUST_MINOR = 84; // wasm32v1-none requires Rust 1.84+
export const REQUIRED_BUILD_TARGET = "wasm32v1-none";

/**
 * Run an external command and return its trimmed stdout. Returns null when the
 * command is absent or exits non-zero; the caller decides what that means.
 *
 * We deliberately avoid shell interpolation: args are passed as an array and
 * never concatenated into a command string.
 */
function tryExec(
  file: string,
  args: string[],
  cwd?: string,
  timeoutMs = 10_000,
): string | null {
  try {
    const result = spawnSync(file, args, {
      cwd,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    if (result.status !== 0) return null;
    return result.stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Run an external command and return both stdout and stderr trimmed. Returns
 * null when the command is absent or exits non-zero.
 */
function tryExecFull(
  file: string,
  args: string[],
  cwd?: string,
  timeoutMs = 10_000,
): { stdout: string; stderr: string } | null {
  try {
    const result = spawnSync(file, args, {
      cwd,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    if (result.status !== 0 && result.status !== null) return null;
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch {
    return null;
  }
}

/** Probe writability of a directory by creating and immediately deleting a
 * temporary file. No persistent side effect is left. */
function probeWritable(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  const probe = path.join(dir, `.weighin-doctor-probe-${process.pid}`);
  try {
    fs.writeFileSync(probe, "probe", { flag: "wx" });
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  } finally {
    // Belt-and-suspenders: remove even if unlink above threw.
    try {
      if (fs.existsSync(probe)) fs.unlinkSync(probe);
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkPlatform(): DiagnosticCheck {
  const supported = process.platform === "linux" && process.arch === "x64";
  return {
    name: "Host platform",
    status: supported ? "pass" : "fail",
    detail: `${process.platform}/${process.arch}`,
    remediation: supported
      ? undefined
      : "WeighIn requires Linux x64. Native simulation is not supported on other platforms or architectures.",
  };
}

function checkNodeVersion(): DiagnosticCheck {
  const version = process.version; // e.g. "v24.0.0"
  const match = version.match(/^v(\d+)\./);
  const major = match ? Number(match[1]) : 0;
  const supported = major >= 20;
  return {
    name: "Node.js",
    status: supported ? "pass" : "fail",
    detail: version,
    remediation: supported
      ? undefined
      : "Node.js 20 or later is required. The GitHub Action runtime targets Node 24.",
  };
}

function checkStellarCli(): DiagnosticCheck {
  const output = tryExec("stellar", ["--version"]);
  if (output === null) {
    return {
      name: "stellar CLI",
      status: "fail",
      detail: "not found",
      remediation:
        "Install Stellar CLI 28.1.0 from https://github.com/stellar/stellar-cli/releases. " +
        "The default contract builder requires `stellar contract build --locked --optimize=true`.",
    };
  }

  const match = output.match(/stellar (\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return {
      name: "stellar CLI",
      status: "unknown",
      detail: `installed but version unparseable: ${output.slice(0, 80)}`,
      remediation:
        "Verify the Stellar CLI installation. Expected output matching 'stellar X.Y.Z'.",
    };
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const meetsVersion =
    major > REQUIRED_STELLAR_MAJOR ||
    (major === REQUIRED_STELLAR_MAJOR && minor >= REQUIRED_STELLAR_MINOR);

  // Also check optimization support: build.ts requires it.
  if (!meetsVersion) {
    return {
      name: "stellar CLI",
      status: "fail",
      detail: output,
      remediation: `Stellar CLI ${REQUIRED_STELLAR_MAJOR}.${REQUIRED_STELLAR_MINOR}.0 or later with optimization support is required. Got ${output}.`,
    };
  }

  return { name: "stellar CLI", status: "pass", detail: output };
}

function checkRustc(): DiagnosticCheck {
  const output = tryExec("rustc", ["--version"]);
  if (output === null) {
    return {
      name: "rustc",
      status: "fail",
      detail: "not found",
      remediation:
        "Install Rust via rustup: https://rustup.rs/. Rust 1.84+ is required for the wasm32v1-none target. " +
        "The simulation helper build uses Rust 1.95.0.",
    };
  }

  const match = output.match(/^rustc (\d+)\.(\d+)\./);
  if (!match) {
    return {
      name: "rustc",
      status: "unknown",
      detail: `installed but version unparseable: ${output.slice(0, 80)}`,
      remediation: "Verify the Rust installation. Expected 'rustc X.Y.Z ...'.",
    };
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const meetsVersion =
    major > REQUIRED_RUST_MAJOR ||
    (major === REQUIRED_RUST_MAJOR && minor >= REQUIRED_RUST_MINOR);

  if (!meetsVersion) {
    return {
      name: "rustc",
      status: "fail",
      detail: output,
      remediation: `Rust ${REQUIRED_RUST_MAJOR}.${REQUIRED_RUST_MINOR}+ is required for ${REQUIRED_BUILD_TARGET}. Got ${output}.`,
    };
  }

  return { name: "rustc", status: "pass", detail: output };
}

function checkCargo(): DiagnosticCheck {
  const output = tryExec("cargo", ["--version"]);
  if (output === null) {
    return {
      name: "cargo",
      status: "fail",
      detail: "not found",
      remediation:
        "Cargo is included with a standard Rust installation via rustup: https://rustup.rs/.",
    };
  }
  return { name: "cargo", status: "pass", detail: output };
}

function checkDocker(): DiagnosticCheck {
  const output = tryExec("docker", ["--version"]);
  if (output === null) {
    return {
      name: "docker",
      status: "fail",
      detail: "not found",
      remediation:
        "Install Docker to run a local Stellar standalone network via stellar/quickstart. " +
        "See https://docs.docker.com/get-docker/.",
    };
  }

  // Also probe socket reachability (non-fatal: docker may be present but daemon is down).
  const ping = tryExec(
    "docker",
    ["info", "--format", "{{.ServerVersion}}"],
    undefined,
    5_000,
  );
  if (ping === null) {
    return {
      name: "docker",
      status: "fail",
      detail: `${output} (daemon unreachable)`,
      remediation:
        "Docker is installed but the daemon is not running or not accessible. " +
        "Start Docker and ensure the current user has permission to connect to the socket.",
    };
  }

  return {
    name: "docker",
    status: "pass",
    detail: `${output}; server ${ping}`,
  };
}

function checkBuildTarget(): DiagnosticCheck {
  // `rustup target list --installed` outputs one target per line.
  const result = tryExecFull("rustup", ["target", "list", "--installed"]);
  if (result === null) {
    return {
      name: `build target (${REQUIRED_BUILD_TARGET})`,
      status: "unknown",
      detail: "rustup not available or target list failed",
      remediation: `Install rustup and add the target: rustup target add ${REQUIRED_BUILD_TARGET}`,
    };
  }

  const targets = result.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (targets.includes(REQUIRED_BUILD_TARGET)) {
    return {
      name: `build target (${REQUIRED_BUILD_TARGET})`,
      status: "pass",
      detail: `${REQUIRED_BUILD_TARGET} installed`,
    };
  }

  return {
    name: `build target (${REQUIRED_BUILD_TARGET})`,
    status: "fail",
    detail: `${REQUIRED_BUILD_TARGET} not installed`,
    remediation: `Add the required Rust target: rustup target add ${REQUIRED_BUILD_TARGET}`,
  };
}

function checkHelperSources(): DiagnosticCheck {
  // The native simulation helper sources ship inside the package.
  const helperDir = path.resolve(__dirname, "../native/simulation");
  const manifest = path.join(helperDir, "Cargo.toml");
  const lock = path.join(helperDir, "Cargo.lock");
  const src = path.join(helperDir, "src", "main.rs");

  const missing: string[] = [];
  if (!fs.existsSync(manifest)) missing.push("Cargo.toml");
  if (!fs.existsSync(lock)) missing.push("Cargo.lock");
  if (!fs.existsSync(src)) missing.push("src/main.rs");

  if (missing.length > 0) {
    return {
      name: "native simulation helper sources",
      status: "fail",
      detail: `missing: ${missing.join(", ")}`,
      remediation:
        "Reinstall the WeighIn package or restore the native/simulation directory from source. " +
        "The helper sources are required to build the protocol-28 simulation binary.",
    };
  }

  return {
    name: "native simulation helper sources",
    status: "pass",
    detail: `present (${helperDir})`,
  };
}

function checkHelperExecutable(): DiagnosticCheck {
  // Check for an already-built helper or an explicit override.
  const override =
    process.env.WEIGHIN_HELPER_PATH ??
    path.resolve(
      __dirname,
      "../native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation",
    );

  if (!fs.existsSync(override)) {
    return {
      name: "native simulation helper (built)",
      status: "unknown",
      detail: "not yet built",
      remediation:
        "Build the helper with: npm run build:helper\n" +
        "Or provide an existing binary via WEIGHIN_HELPER_PATH or --helper-path.",
    };
  }

  try {
    fs.accessSync(override, fs.constants.X_OK);
  } catch {
    return {
      name: "native simulation helper (built)",
      status: "fail",
      detail: `not executable: ${override}`,
      remediation: `Ensure the helper binary at ${override} has execute permission (chmod +x).`,
    };
  }

  return {
    name: "native simulation helper (built)",
    status: "pass",
    detail: override,
  };
}

function checkTmpDir(): DiagnosticCheck {
  const tmpDir = os.tmpdir();
  const writable = probeWritable(tmpDir);
  return {
    name: "temporary storage (TMPDIR)",
    status: writable ? "pass" : "fail",
    detail: tmpDir,
    remediation: writable
      ? undefined
      : "The temporary directory is not writable. Set TMPDIR to a writable path before running WeighIn. " +
        "The contract builder and storage probe both require writable TMPDIR.",
  };
}

async function checkRpcEndpoint(
  rpcUrl: string,
): Promise<{ health: DiagnosticCheck; network: DiagnosticCheck }> {
  const displayUrl = sanitizeEndpoint(rpcUrl);

  // Health check.
  let healthCheck: DiagnosticCheck;
  let networkCheckUrl = displayUrl;
  let networkCallNeeded = true;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      healthCheck = {
        name: "RPC endpoint (health)",
        status: "fail",
        detail: `${displayUrl} — HTTP ${res.status} ${res.statusText}`,
        remediation:
          `The RPC endpoint at ${displayUrl} is not responding. ` +
          "Start the standalone network (stellar/quickstart) and pass its URL with --rpc-url.",
      };
      networkCallNeeded = false;
    } else {
      let parsed: { result?: { status?: unknown } };
      try {
        parsed = (await res.json()) as typeof parsed;
      } catch {
        healthCheck = {
          name: "RPC endpoint (health)",
          status: "fail",
          detail: `${displayUrl} — malformed JSON response`,
          remediation:
            `The endpoint at ${displayUrl} returned a non-JSON response. ` +
            "Verify it is a compatible Stellar RPC endpoint.",
        };
        networkCallNeeded = false;
        return {
          health: healthCheck,
          network: {
            name: "RPC endpoint (network)",
            status: "unknown",
            detail: "skipped (health check failed)",
          },
        };
      }
      if (parsed?.result && (parsed.result as any).status === "healthy") {
        healthCheck = {
          name: "RPC endpoint (health)",
          status: "pass",
          detail: `${displayUrl} — healthy`,
        };
      } else {
        healthCheck = {
          name: "RPC endpoint (health)",
          status: "fail",
          detail: `${displayUrl} — not healthy: ${JSON.stringify(parsed?.result ?? parsed)}`,
          remediation:
            `The RPC endpoint at ${displayUrl} is not reporting healthy. ` +
            "Wait for the standalone network to finish starting up.",
        };
        networkCallNeeded = false;
      }
    }
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const message = redactEndpointSecrets(rawMessage, rpcUrl);
    healthCheck = {
      name: "RPC endpoint (health)",
      status: "fail",
      detail: `${displayUrl} — unreachable: ${message}`,
      remediation:
        `Cannot reach the RPC endpoint at ${displayUrl}. ` +
        "Start a local Stellar quickstart network or provide the correct --rpc-url. " +
        "See docs/network-readiness.md for provisioning instructions.",
    };
    networkCallNeeded = false;
  }

  if (!networkCallNeeded) {
    return {
      health: healthCheck,
      network: {
        name: "RPC endpoint (network)",
        status: "unknown",
        detail: "skipped (health check failed)",
      },
    };
  }

  // Network metadata check.
  let networkCheck: DiagnosticCheck;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "getNetwork" }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      networkCheck = {
        name: "RPC endpoint (network)",
        status: "fail",
        detail: `${displayUrl} — HTTP ${res.status}`,
        remediation:
          "Verify the RPC endpoint is a compatible standalone Stellar RPC.",
      };
    } else {
      const metadata = (await res.json()) as {
        result?: { passphrase?: unknown; protocolVersion?: unknown };
      };
      const r = metadata?.result;
      if (
        typeof r?.passphrase !== "string" ||
        !r.passphrase.trim() ||
        !Number.isInteger(r.protocolVersion)
      ) {
        networkCheck = {
          name: "RPC endpoint (network)",
          status: "fail",
          detail: `${displayUrl} — missing passphrase or protocolVersion`,
          remediation:
            "The RPC endpoint returned incomplete network metadata. " +
            "Ensure it is a compatible Stellar RPC endpoint (protocol 28, standalone network).",
        };
      } else if (r.passphrase !== SUPPORTED_NETWORK_PASSPHRASE) {
        networkCheck = {
          name: "RPC endpoint (network)",
          status: "fail",
          detail: `${displayUrl} — unsupported passphrase: "${r.passphrase}"`,
          remediation:
            `WeighIn supports only the standalone network (passphrase: "${SUPPORTED_NETWORK_PASSPHRASE}"). ` +
            "Public Stellar network endpoints are outside the supported measurement scope.",
        };
      } else if (r.protocolVersion !== SUPPORTED_PROTOCOL_VERSION) {
        networkCheck = {
          name: "RPC endpoint (network)",
          status: "fail",
          detail: `${displayUrl} — unsupported protocol ${r.protocolVersion}`,
          remediation:
            `WeighIn requires protocol ${SUPPORTED_PROTOCOL_VERSION}. Got protocol ${r.protocolVersion}. ` +
            "Use the pinned protocol-28 stellar/quickstart image.",
        };
      } else {
        networkCheck = {
          name: "RPC endpoint (network)",
          status: "pass",
          detail: `${displayUrl} — passphrase OK, protocol ${r.protocolVersion}`,
        };
      }
    }
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const message = redactEndpointSecrets(rawMessage, rpcUrl);
    networkCheck = {
      name: "RPC endpoint (network)",
      status: "fail",
      detail: `${displayUrl} — unreachable: ${message}`,
      remediation:
        "Could not retrieve network metadata. Verify the RPC endpoint is running and reachable.",
    };
  }

  return { health: healthCheck, network: networkCheck };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface DoctorOptions {
  /** RPC URL to probe for health and network metadata (redacted in output). */
  rpcUrl?: string;
}

/**
 * Run all diagnostic checks and return a structured report. The function never
 * throws: every diagnostic is captured and represented as a check entry.
 */
export async function runDoctor(
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const checks: DiagnosticCheck[] = [];

  // Platform.
  checks.push(checkPlatform());

  // Node.js version.
  checks.push(checkNodeVersion());

  // Required CLI tools.
  checks.push(checkStellarCli());
  checks.push(checkRustc());
  checks.push(checkCargo());
  checks.push(checkDocker());

  // Build target.
  checks.push(checkBuildTarget());

  // Native simulation helper.
  checks.push(checkHelperSources());
  checks.push(checkHelperExecutable());

  // Storage.
  checks.push(checkTmpDir());

  // RPC endpoint (optional — skipped when no URL is provided).
  if (options.rpcUrl) {
    const { health, network } = await checkRpcEndpoint(options.rpcUrl);
    checks.push(health);
    checks.push(network);
  }

  const healthy = checks.every((c) => c.status === "pass");
  return { checks, healthy };
}

// ---------------------------------------------------------------------------
// Formatted output
// ---------------------------------------------------------------------------

const STATUS_SYMBOL: Record<CheckStatus, string> = {
  pass: "✔",
  fail: "✖",
  unknown: "?",
};

/**
 * Format a DoctorReport as a human-readable string for display on the terminal.
 * The output never repeats raw URLs: credential-carrying values must be
 * sanitized by the caller before they reach DiagnosticCheck.detail.
 */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = ["WeighIn environment diagnostics", ""];
  for (const check of report.checks) {
    const symbol = STATUS_SYMBOL[check.status];
    lines.push(`  ${symbol} ${check.name}: ${check.detail}`);
    if (
      (check.status === "fail" || check.status === "unknown") &&
      check.remediation
    ) {
      for (const line of check.remediation.split("\n")) {
        lines.push(`      ${line}`);
      }
    }
  }
  lines.push("");
  if (report.healthy) {
    lines.push("All checks passed.");
  } else {
    const failing = report.checks.filter(
      (c) => c.status === "fail" || c.status === "unknown",
    ).length;
    lines.push(`${failing} check(s) failed or could not be verified.`);
  }
  return lines.join("\n");
}
