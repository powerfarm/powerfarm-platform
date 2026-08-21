import assert from "node:assert/strict";
import test from "node:test";
import { validateProductionMigrationState } from "./check-production-migration-state.mjs";

const canonical = "570715a75ddf40288834e0249f37e77754034511";
const legacyCommit = "60f3f34097a38a29eac6fd91ef6e5fa0958d23d4";
const base = {
  migration: {
    canonicalRuntimeBaselineCommit: canonical,
    productionBaselineActivated: false,
    productionDeployControllerEnabled: false,
  },
  plan: {
    kind: "one-time-production-activation",
    canonicalRuntimeBaselineCommit: canonical,
    legacyProductionSourceCommit: legacyCommit,
    targetWorker: "powerfarm-gk-identity",
    steadyStateControllerAfterSuccess: false,
  },
  legacy: {
    kind: "historical-production-evidence",
    sourceCommit: legacyCommit,
  },
  request: { requested: false },
  anchor: null,
  steadyStateWorkflowExists: false,
};

test("pre-activation state is valid with no active anchor", () => {
  assert.deepEqual(validateProductionMigrationState(structuredClone(base)), []);
});

test("post-activation state is valid only with canonical anchor and disarmed request", () => {
  const input = structuredClone(base);
  input.migration.productionBaselineActivated = true;
  input.anchor = {
    commit: canonical,
    activation: {
      changedWorker: "powerfarm-gk-identity",
      historicalSourceCommit: legacyCommit,
    },
  };
  assert.deepEqual(validateProductionMigrationState(input), []);
});

test("legacy commit can never become the active new-history anchor", () => {
  const input = structuredClone(base);
  input.migration.productionBaselineActivated = true;
  input.anchor = {
    commit: legacyCommit,
    activation: {
      changedWorker: "powerfarm-gk-identity",
      historicalSourceCommit: legacyCommit,
    },
  };
  const errors = validateProductionMigrationState(input);
  assert.ok(errors.some((error) => error.includes("canonical runtime baseline")));
  assert.ok(errors.some((error) => error.includes("legacy Git SHA")));
});

test("steady-state deploy workflow is forbidden during one-time migration", () => {
  const input = structuredClone(base);
  input.steadyStateWorkflowExists = true;
  assert.ok(validateProductionMigrationState(input).some((error) => error.includes("deploy.yml")));
});
