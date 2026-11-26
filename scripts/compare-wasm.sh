#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <base.wasm> <head.wasm>" >&2
  exit 2
fi

base_wasm=$1
head_wasm=$2

if [[ ! -f "$base_wasm" ]]; then
  echo "Error: file not found: $base_wasm" >&2
  exit 1
fi
if [[ ! -f "$head_wasm" ]]; then
  echo "Error: file not found: $head_wasm" >&2
  exit 1
fi

extract_exports() {
  local wasm_file=$1
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("node:fs");
      const bytes = fs.readFileSync(process.argv[1]);
      const module = new WebAssembly.Module(bytes);
      for (const item of WebAssembly.Module.exports(module)) {
        if (item.kind === "function") process.stdout.write(`${item.name}\n`);
      }
    ' "$wasm_file" | sort -u
  elif command -v wasm-objdump >/dev/null 2>&1; then
    wasm-objdump -x "$wasm_file" |
      sed -n 's/^.*-> "\([^"]*\)".*/\1/p' |
      sort -u
  else
    echo "Error: Node.js or wasm-objdump is required to inspect WASM exports." >&2
    exit 1
  fi
}

base_exports=$(mktemp)
head_exports=$(mktemp)
trap 'rm -f "$base_exports" "$head_exports"' EXIT

extract_exports "$base_wasm" >"$base_exports"
extract_exports "$head_wasm" >"$head_exports"

base_only=$(comm -23 <(sort "$base_exports") <(sort "$head_exports") || true)
head_only=$(comm -13 <(sort "$base_exports") <(sort "$head_exports") || true)

printf 'WASM export comparison\n'
printf 'Base: %s\n' "$base_wasm"
printf 'Head: %s\n' "$head_wasm"
printf '\nAdded contract entrypoints:\n'
if [[ -n "$head_only" ]]; then
  printf '  + %s\n' $head_only
else
  printf '  (none)\n'
fi
printf '\nRemoved contract entrypoints:\n'
if [[ -n "$base_only" ]]; then
  printf '  - %s\n' $base_only
else
  printf '  (none)\n'
fi
