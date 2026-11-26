#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { FixturesSpecSchema, formatZodError } = require("../dist/measurement");

function printHelp() {
  console.log(
    `Usage: node scripts/validate-fixtures.js <path-to-fixtures.json>

Validate a WeighIn fixture file against the Zod schema used by measurements.

Options:
  -h, --help   Show this help text

Exit codes:
  0  Fixture is valid
  1  Fixture is invalid, unreadable, or the wrong arguments were given`,
  );
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  if (args.length !== 1) {
    console.error(
      "Error: expected exactly one fixture file path. Use --help for usage.",
    );
    process.exitCode = 1;
    return;
  }

  const targetPath = path.resolve(process.cwd(), args[0]);
  let raw;
  try {
    raw = fs.readFileSync(targetPath, "utf8");
  } catch (error) {
    console.error(`Error reading ${args[0]}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    console.error(`Invalid JSON in ${args[0]}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const result = FixturesSpecSchema.safeParse(data);
  if (result.success) {
    console.log(`Valid fixture: ${args[0]}`);
    return;
  }

  console.error(formatZodError(result.error, args[0]));
  process.exitCode = 1;
}

main();
