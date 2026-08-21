#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function finalizeActivationState({ migration, request, anchor, plan, completedAt }) {
  if (plan?.kind !== "one-time-production-activation") {
    throw new Error("invalid production activation plan");
  }
  if (anchor?.commit !== plan.canonicalRuntimeBaselineCommit) {
    throw new Error("active production anchor does not point at canonical runtime baseline");
  }
  if (plan.target !== "identity" || plan.targetWorker !== "powerfarm-gk-identity") {
    throw new Error("one-time activation target is not the reviewed Identity debt");
  }
  if (plan.steadyStateControllerAfterSuccess !== false) {
    throw new Error("one-time activation may not enable the steady-state deploy controller");
  }
  if (migration.productionDeployControllerEnabled !== false) {
    throw new Error("steady-state deploy controller must be disabled before activation finalization");
  }

  return {
    migration: {
      ...migration,
      productionBaselineActivated: true,
      productionDeployControllerEnabled: false,
    },
    request: {
      ...request,
      requested: false,
      completedAt,
      activatedRuntimeCommit: anchor.commit,
    },
    anchor: {
      ...anchor,
      activation: {
        mode: "legacy-baseline-to-canonical-identity-only",
        historicalSourceCommit: plan.legacyProductionSourceCommit,
        changedWorker: plan.targetWorker,
      },
    },
  };
}

async function load(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

async function main() {
  const migrationPath = "state/migration-source.json";
  const requestPath = "state/activation-request.json";
  const anchorPath = "state/ultimo-deploy.json";
  const planPath = "state/production-activation-plan.json";
  const [migration, request, anchor, plan] = await Promise.all([
    load(migrationPath), load(requestPath), load(anchorPath), load(planPath),
  ]);
  const finalized = finalizeActivationState({
    migration,
    request,
    anchor,
    plan,
    completedAt: new Date().toISOString(),
  });
  await Promise.all([
    writeFile(resolve(root, migrationPath), JSON.stringify(finalized.migration, null, 2) + "\n"),
    writeFile(resolve(root, requestPath), JSON.stringify(finalized.request, null, 2) + "\n"),
    writeFile(resolve(root, anchorPath), JSON.stringify(finalized.anchor, null, 2) + "\n"),
  ]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
