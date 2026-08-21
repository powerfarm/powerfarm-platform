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

test("deploy controller state is explicit and safe", async () => {
  const migration = JSON.parse(
    await readFile(resolve(root, "state/migration-source.json"), "utf8"),
  );
  const workflowPath = resolve(root, ".github/workflows/deploy.yml");
  const statePath = resolve(root, "state/ultimo-deploy.json");

  if (migration.productionDeployControllerEnabled === false) {
    assert.equal(await isMissing(workflowPath), true,
      "deploy.yml must stay absent while the new repository is not the production controller");
    assert.equal(await isMissing(statePath), true,
      "ultimo-deploy.json must be re-anchored in the new Git history before enabling deploys");
    return;
  }

  assert.equal(migration.productionDeployControllerEnabled, true,
    "productionDeployControllerEnabled must be an explicit boolean");

  const workflow = await readFile(workflowPath, "utf8");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(typeof state.commit, "string");
  assert.ok(state.commit.length >= 40, "deployment anchor must contain a Git commit SHA");
  assert.match(workflow, /LAST=.*state\/ultimo-deploy\.json/);
  assert.match(workflow, /select-deploy-targets\.mjs --base "\$LAST" --head/);
  assert.doesNotMatch(workflow, /select-deploy-targets\.mjs --base '\$\{\{ github\.event\.before \}\}'/);
});
