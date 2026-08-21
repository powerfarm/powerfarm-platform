import assert from "node:assert/strict";
import test from "node:test";
import { finalizeActivationState } from "./finalize-production-activation.mjs";

const canonical = "570715a75ddf40288834e0249f37e77754034511";
const plan = {
  kind: "one-time-production-activation",
  canonicalRuntimeBaselineCommit: canonical,
  legacyProductionSourceCommit: "60f3f34097a38a29eac6fd91ef6e5fa0958d23d4",
  target: "identity",
  targetWorker: "powerfarm-gk-identity",
  steadyStateControllerAfterSuccess: false,
};

test("successful activation creates an anchored-but-not-continuous state", () => {
  const result = finalizeActivationState({
    migration: {
      productionBaselineActivated: false,
      productionDeployControllerEnabled: false,
    },
    request: { requested: true },
    anchor: { commit: canonical, workers: {} },
    plan,
    completedAt: "2026-08-21T12:30:00.000Z",
  });

  assert.equal(result.migration.productionBaselineActivated, true);
  assert.equal(result.migration.productionDeployControllerEnabled, false);
  assert.equal(result.request.requested, false);
  assert.equal(result.request.activatedRuntimeCommit, canonical);
  assert.equal(result.anchor.commit, canonical);
  assert.deepEqual(result.anchor.activation, {
    mode: "legacy-baseline-to-canonical-identity-only",
    historicalSourceCommit: plan.legacyProductionSourceCommit,
    changedWorker: "powerfarm-gk-identity",
  });
});

test("finalization rejects an anchor wider than the canonical runtime baseline", () => {
  assert.throws(() => finalizeActivationState({
    migration: { productionDeployControllerEnabled: false },
    request: { requested: true },
    anchor: { commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    plan,
    completedAt: "2026-08-21T12:30:00.000Z",
  }), /does not point at canonical runtime baseline/);
});

test("finalization cannot silently enable the steady-state controller", () => {
  assert.throws(() => finalizeActivationState({
    migration: { productionDeployControllerEnabled: false },
    request: { requested: true },
    anchor: { commit: canonical },
    plan: { ...plan, steadyStateControllerAfterSuccess: true },
    completedAt: "2026-08-21T12:30:00.000Z",
  }), /may not enable the steady-state deploy controller/);
});
