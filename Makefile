.PHONY: install build bundle test lint

# npm ci, not npm install: the lockfile is committed and CI relies on it.
install:
	npm ci

build:
	npm run build

# bundle runs tsc --noEmit and both esbuild passes, then regenerates the
# fixture schema and provenance manifest.
bundle:
	npm run bundle

# The suite builds the fixture contract and the native helper first, so this
# target needs the Stellar CLI and Rust toolchain on PATH.
test:
	npm test

lint:
	npm run lint
