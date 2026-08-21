#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cfFetch, ownedWorkers, readDeployment } from "./lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function assertDeploymentRead(result, worker) {
  if (!result || !Array.isArray(result.deployments)) {
    throw new Error(`Cloudflare deployments response is invalid for ${worker}`);
  }
  const active = result.deployments[0];
  const versionId = active?.versions?.[0]?.version_id;
  if (!active?.id || !versionId) {
    throw new Error(`Cloudflare returned no active deployment/version for ${worker}`);
  }
  return { deploymentId: active.id, versionId };
}

export async function verifyCloudflareReadAccess(worker) {
  const deployment = await readDeployment(root);
  const owned = new Set(ownedWorkers(deployment));
  if (!owned.has(worker)) throw new Error(`worker is not owned by this deployment: ${worker}`);

  const result = await cfFetch(`/workers/scripts/${worker}/deployments`);
  const active = assertDeploymentRead(result, worker);
  console.log(`✓ Cloudflare API read access confirmed for ${worker} (${active.versionId.slice(0, 8)})`);
  return active;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workerIndex = process.argv.indexOf("--worker");
  const worker = workerIndex >= 0 ? process.argv[workerIndex + 1] : null;
  if (!worker) {
    console.error("--worker is required");
    process.exitCode = 2;
  } else {
    try {
      await verifyCloudflareReadAccess(worker);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
