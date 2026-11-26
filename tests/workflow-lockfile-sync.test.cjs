const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const WORKFLOWS_DIR = path.join(__dirname, "..", ".github/workflows");
const SYNC_STEP_NAME = "Verify package manifest and lockfile are synchronized";

function readWorkflow(file) {
  return YAML.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, file), "utf8"));
}

function workflowFiles() {
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .sort();
}

test("ci.yml and verify-pr.yml are valid YAML workflows", () => {
  for (const file of ["ci.yml", "verify-pr.yml"]) {
    const workflow = readWorkflow(file);
    assert.equal(typeof workflow, "object", `${file} must parse to a mapping`);
    assert.ok(workflow.jobs, `${file} must declare jobs`);
  }
});

test("ci.yml lint-and-test runs npm ci and then verifies the lockfile is in sync", () => {
  const steps = readWorkflow("ci.yml").jobs["lint-and-test"].steps;
  const ciIndex = steps.findIndex(
    (step) => typeof step.run === "string" && /^npm ci\b/m.test(step.run),
  );
  const syncIndex = steps.findIndex((step) => step.name === SYNC_STEP_NAME);

  assert.notEqual(ciIndex, -1, "lint-and-test must install with npm ci");
  assert.notEqual(syncIndex, -1, "lint-and-test must verify the lockfile");
  assert.ok(syncIndex > ciIndex, "lockfile check must run after npm ci");

  const run = steps[syncIndex].run;
  assert.match(run, /npm install --package-lock-only --ignore-scripts/);
  assert.match(run, /git diff --exit-code -- package-lock\.json/);
  assert.match(run, /::error file=package-lock\.json::/);
});

test("workflows install with npm ci, never npm install, outside the lockfile check", () => {
  const offenders = [];
  for (const file of workflowFiles()) {
    const workflow = readWorkflow(file);
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if (typeof step.run !== "string") continue;
        const allowed = file === "ci.yml" && step.name === SYNC_STEP_NAME;
        if (!allowed && /\bnpm (install|i)\b/.test(step.run)) {
          offenders.push(`${file} > ${jobId} > ${step.name ?? step.run}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});
