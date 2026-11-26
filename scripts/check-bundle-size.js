#!/usr/bin/env node

/**
 * Monitor the compiled size of `bundled/index.js` to help catch dependency bloat.
 * Prints the bundle size in KB and emits a warning if it exceeds the threshold (10 MB).
 */

const fs = require("fs");
const path = require("path");

const BUNDLE_REL_PATH = path.join("bundled", "index.js");
const BUNDLE_PATH = path.resolve(__dirname, "..", BUNDLE_REL_PATH);
const THRESHOLD_MB = 10;
const THRESHOLD_BYTES = THRESHOLD_MB * 1024 * 1024;

function formatKB(bytes) {
  return (bytes / 1024).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMB(bytes) {
  return (bytes / (1024 * 1024)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function main() {
  let stats;
  try {
    stats = fs.statSync(BUNDLE_PATH);
  } catch (err) {
    console.error(`ERROR: could not read ${BUNDLE_REL_PATH}: ${err.message}`);
    process.exit(1);
  }

  const sizeBytes = stats.size;
  const exceedsThreshold = sizeBytes > THRESHOLD_BYTES;

  console.log(`Bundle size check: ${BUNDLE_REL_PATH}`);
  console.log(`  Size:      ${formatKB(sizeBytes)} KB (${formatMB(sizeBytes)} MB)`);
  console.log(
    `  Threshold: ${formatKB(THRESHOLD_BYTES)} KB (${formatMB(THRESHOLD_BYTES)} MB)`,
  );

  if (exceedsThreshold) {
    console.warn(
      `WARNING: ${BUNDLE_REL_PATH} (${formatKB(sizeBytes)} KB) exceeds the ${THRESHOLD_MB} MB threshold.`,
    );
  } else {
    console.log("  Status:    OK");
  }
}

main();
