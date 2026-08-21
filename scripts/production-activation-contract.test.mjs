import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readDeployment } from "./lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));

test("one-time activation plan is internally consistent", async () => {
  const [migration, plan, legacy, request, deployment] = await Promise.all([
    readJson("state/migration-source.json"),
    readJson("state/production-activation-plan.json"),
    readJson("state/legacy-production-baseline.json"),
    readJson("state/activation-request.json"),
    readDeployment(root),
  ]);

  assert.equal(plan.kind, "one-time-production-activation");
  assert.match(plan.canonicalRuntimeBaselineCommit, /^[0-9a-f]{40}$/i);
  assert.equal(plan.canonicalRuntimeBaselineCommit, migration.canonicalRuntimeBaselineCommit);
  assert.equal(plan.legacyProductionSourceCommit, legacy.sourceCommit);
  assert.equal(plan.target, "identity");
  assert.equal(plan.targetWorker, deployment.workers.identity.name);
  assert.equal(
    plan.expectedBeforeVersionId,
    legacy.workers[plan.targetWorker].versionId,
  );
  assert.equal(plan.steadyStateControllerAfterSuccess, false);
  assert.equal(migration.productionDeployControllerEnabled, false);
  assert.equal(typeof request.requested, "boolean");
});
