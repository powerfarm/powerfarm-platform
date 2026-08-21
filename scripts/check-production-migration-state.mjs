#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function validateProductionMigrationState({
  migration,
  plan,
  legacy,
  request,
  anchor = null,
  steadyStateWorkflowExists = false,
}) {
  const errors = [];
  const canonical = migration?.canonicalRuntimeBaselineCommit;

  if (!/^[0-9a-f]{40}$/i.test(canonical ?? "")) {
    errors.push("migration canonicalRuntimeBaselineCommit must be a Git SHA");
  }
  if (typeof migration?.productionBaselineActivated !== "boolean") {
    errors.push("productionBaselineActivated must be boolean");
  }
  if (migration?.productionDeployControllerEnabled !== false) {
    errors.push("steady-state deploy controller must remain disabled during migration");
  }
  if (steadyStateWorkflowExists) {
    errors.push("steady-state deploy.yml must be absent while the controller is disabled");
  }

  if (plan?.kind !== "one-time-production-activation") {
    errors.push("production activation plan kind is invalid");
  }
  if (plan?.canonicalRuntimeBaselineCommit !== canonical) {
    errors.push("activation plan and migration disagree on canonical runtime commit");
  }
  if (legacy?.kind !== "historical-production-evidence") {
    errors.push("legacy production baseline must be marked historical evidence");
  }
  if (plan?.legacyProductionSourceCommit !== legacy?.sourceCommit) {
    errors.push("activation plan and historical evidence disagree on legacy source commit");
  }
  if (plan?.steadyStateControllerAfterSuccess !== false) {
    errors.push("one-time activation may not enable steady-state deployment");
  }
  if (typeof request?.requested !== "boolean") {
    errors.push("activation request must contain a boolean requested flag");
  }

  if (migration?.productionBaselineActivated === false) {
    if (anchor !== null) errors.push("ultimo-deploy must be absent before production baseline activation");
  } else if (migration?.productionBaselineActivated === true) {
    if (!anchor) {
      errors.push("activated production baseline requires ultimo-deploy");
    } else {
      if (anchor.commit !== canonical) {
        errors.push("active anchor must point to canonical runtime baseline commit");
      }
      if (anchor.commit === legacy?.sourceCommit) {
        errors.push("legacy Git SHA cannot be the active anchor in the new repository");
      }
      if (anchor.activation?.changedWorker !== plan?.targetWorker) {
        errors.push("active anchor does not attest the planned changed Worker");
      }
      if (anchor.activation?.historicalSourceCommit !== legacy?.sourceCommit) {
        errors.push("active anchor lost historical source provenance");
      }
    }
    if (request?.requested !== false) {
      errors.push("activation request must be disarmed after successful activation");
    }
  }

  return errors;
}

function load(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function main() {
  const anchorPath = resolve(root, "state/ultimo-deploy.json");
  const errors = validateProductionMigrationState({
    migration: load("state/migration-source.json"),
    plan: load("state/production-activation-plan.json"),
    legacy: load("state/legacy-production-baseline.json"),
    request: load("state/activation-request.json"),
    anchor: existsSync(anchorPath) ? JSON.parse(readFileSync(anchorPath, "utf8")) : null,
    steadyStateWorkflowExists: existsSync(resolve(root, ".github/workflows/deploy.yml")),
  });

  if (errors.length) {
    for (const error of errors) console.error(`✗ ${error}`);
    throw new Error(`production migration state invalid (${errors.length} error(s))`);
  }
  console.log("✓ production migration state is internally consistent");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
