import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEPLOYMENT_ORDER, selectDeploymentTargets } from "./select-deploy-targets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function isMissing(path) {
  try {
    await readFile(path, "utf8");
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

test("identity-only changes redeploy only Identity", () => {
  assert.deepEqual(
    selectDeploymentTargets([
      "packages/gatekeeper-identity/src/registry-client.ts",
      "packages/gatekeeper-identity/src/registry-client.test.ts",
    ]),
    ["identity"],
  );
});

test("Engine and Identity changes preserve dependency order", () => {
  assert.deepEqual(
    selectDeploymentTargets([
      "packages/gatekeeper-identity/src/identity.ts",
      "packages/powerfarm-engine/src/workspace-runtime.ts",
    ]),
    ["engine", "identity"],
  );
});

test("shared topology changes force full convergence", () => {
  assert.deepEqual(selectDeploymentTargets(["deployment.jsonc"]), DEPLOYMENT_ORDER);
  assert.deepEqual(selectDeploymentTargets(["scripts/deploy-powerfarm.mjs"]), DEPLOYMENT_ORDER);
  assert.deepEqual(selectDeploymentTargets(["cloudflare-os"]), DEPLOYMENT_ORDER);
});

test("docs and workflow-only edits do not redeploy Workers", () => {
  assert.deepEqual(
    selectDeploymentTargets(["docs/runtime.md", ".github/workflows/pr.yml", "README.md"]),
    [],
  );
});

test("migration state keeps activation and steady-state deployment separate", async () => {
  const migration = JSON.parse(
    await readFile(resolve(root, "state/migration-source.json"), "utf8"),
  );
  const workflowPath = resolve(root, ".github/workflows/deploy.yml");
  const statePath = resolve(root, "state/ultimo-deploy.json");

  assert.equal(typeof migration.productionBaselineActivated, "boolean");
  assert.equal(typeof migration.productionDeployControllerEnabled, "boolean");

  if (!migration.productionDeployControllerEnabled) {
    assert.equal(await isMissing(workflowPath), true,
      "steady-state deploy.yml must stay absent while the controller is disabled");

    if (!migration.productionBaselineActivated) {
      assert.equal(await isMissing(statePath), true,
        "ultimo-deploy.json must stay absent until one-time production activation succeeds");
    } else {
      assert.equal(await isMissing(statePath), false,
        "activated production baseline must have a new-history ultimo-deploy.json");
    }
    return;
  }

  assert.equal(migration.productionBaselineActivated, true,
    "steady-state deploy cannot be enabled before the new production baseline is activated");

  const workflow = await readFile(workflowPath, "utf8");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.match(state.commit ?? "", /^[0-9a-f]{40}$/i,
    "deployment anchor must contain a Git commit SHA");
  assert.match(workflow, /LAST=.*state\/ultimo-deploy\.json/);
  assert.match(workflow, /select-deploy-targets\.mjs --base "\$LAST" --head/);
  assert.doesNotMatch(workflow, /select-deploy-targets\.mjs --base '\$\{\{ github\.event\.before \}\}'/);
});
