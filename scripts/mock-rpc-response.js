#!/usr/bin/env node

"use strict";

function parseArgs(argv) {
  const values = { cpu: 0, memory: 0, bytes: 0, id: 1 };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cpu" || arg === "--memory" || arg === "--bytes" || arg === "--id") {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      if (key === "id") {
        values.id = next;
      } else {
        const parsed = Number(next);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`Invalid numeric value for ${arg}: ${next}`);
        }
        values[key] = parsed;
      }
      i += 1;
    } else if (arg.startsWith("--")) {
      const [name, rawValue] = arg.slice(2).split("=", 2);
      if (rawValue === undefined) {
        throw new Error(`Missing value for --${name}`);
      }
      if (name === "id") {
        values.id = rawValue;
      } else if (["cpu", "memory", "bytes"].includes(name)) {
        const parsed = Number(rawValue);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`Invalid numeric value for --${name}: ${rawValue}`);
        }
        values[name] = parsed;
      } else {
        throw new Error(`Unknown option --${name}`);
      }
    } else {
      positional.push(arg);
    }
  }

  for (let i = 0; i < Math.min(positional.length, 3); i += 1) {
    const parsed = Number(positional[i]);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Invalid positional numeric value: ${positional[i]}`);
    }
    if (i === 0) values.cpu = parsed;
    if (i === 1) values.memory = parsed;
    if (i === 2) values.bytes = parsed;
  }

  return values;
}

try {
  const values = parseArgs(process.argv.slice(2));
  const cpu = String(Math.trunc(values.cpu));
  const memory = String(Math.trunc(values.memory));
  const bytes = String(Math.trunc(values.bytes));

  const response = {
    jsonrpc: "2.0",
    id: values.id,
    result: {
      transactionData: "AAAAAA==",
      minResourceFee: "100",
      latestLedger: 1,
      events: [],
      results: [],
      cost: {
        cpuInsns: cpu,
        memBytes: memory,
      },
      resourceConsumption: {
        cpuInstructions: cpu,
        memoryBytes: memory,
        transactionBytes: bytes,
      },
    },
  };

  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
