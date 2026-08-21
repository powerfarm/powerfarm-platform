#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cfFetch, ownedWorkers, readDeployment, readJson } from "./lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function compareProductionBaseline(expectedWorkers, observedWorkers) {
  const issues = [];
  const expectedNames = sorted(Object.keys(expectedWorkers ?? {}));
  const observedNames = sorted(Object.keys(observedWorkers ?? {}));

  if (JSON.stringify(expectedNames) !== JSON.stringify(observedNames)) {
    issues.push({
      kind: "worker-set",
      expected: expectedNames,
      observed: observedNames,
    });
  }

  for (const worker of expectedNames) {
    const expected = expectedWorkers?.[worker] ?? null;
    const observed = observedWorkers?.[worker] ?? null;
    if (!observed?.versionId) {
      issues.push({ kind: "missing-version", worker, expected, observed });
      continue;
    }
    if (observed.versionId !== expected?.versionId) {
      issues.push({ kind: "version", worker, expected, observed });
    }
    if (observed.deploymentId !== expected?.deploymentId) {
      issues.push({ kind: "deployment", worker, expected, observed });
    }
  }

  return issues;
}

export async function readLiveDeployments(workerNames) {
  const pairs = await Promise.all(workerNames.map(async (worker) => {
    const result = await cfFetch(`/workers/scripts/${worker}/deployments`);
    const active = result?.deployments?.[0] ?? null;
    return [worker, active ? {
      deploymentId: active.id ?? null,
      versionId: active.versions?.[0]?.version_id ?? null,
    } : null];
  }));
  return Object.fromEntries(pairs);
}

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

export async function verifyLegacyProduction({
  baselinePath = resolve(root, "state/legacy-production-baseline.json"),
  snapshotOut = null,
} = {}) {
  const baseline = readJson(baselinePath);
  if (baseline?.kind !== "historical-production-evidence") {
    throw new Error(`baseline histórico inválido: ${baselinePath}`);
  }
  if (!/^[0-9a-f]{40}$/i.test(baseline.sourceCommit ?? "")) {
    throw new Error("baseline histórico não contém sourceCommit Git válido");
  }

  const deployment = await readDeployment(root);
  const declaredWorkers = sorted(ownedWorkers(deployment));
  const baselineWorkers = sorted(Object.keys(baseline.workers ?? {}));
  if (JSON.stringify(declaredWorkers) !== JSON.stringify(baselineWorkers)) {
    throw new Error(
      `baseline histórico cobre conjunto diferente de Workers\n` +
      `  repo: ${declaredWorkers.join(", ")}\n` +
      `  baseline: ${baselineWorkers.join(", ")}`,
    );
  }

  const observed = await readLiveDeployments(declaredWorkers);
  const issues = compareProductionBaseline(baseline.workers, observed);

  for (const worker of declaredWorkers) {
    const live = observed[worker];
    const expected = baseline.workers[worker];
    if (live?.versionId === expected?.versionId && live?.deploymentId === expected?.deploymentId) {
      console.log(`✓ ${worker}: ${live.versionId.slice(0, 8)} / ${live.deploymentId.slice(0, 8)}`);
    }
  }

  if (issues.length) {
    for (const issue of issues) {
      if (issue.kind === "worker-set") {
        console.error("✗ conjunto de Workers vivo não corresponde ao baseline histórico");
        continue;
      }
      const expected = issue.expected ?? {};
      const observedEntry = issue.observed ?? {};
      if (issue.kind === "version") {
        console.error(
          `✗ ${issue.worker}: versionId mudou ` +
          `(${expected.versionId ?? "nenhum"} -> ${observedEntry.versionId ?? "nenhum"})`,
        );
      } else if (issue.kind === "deployment") {
        console.error(
          `✗ ${issue.worker}: deploymentId mudou ` +
          `(${expected.deploymentId ?? "nenhum"} -> ${observedEntry.deploymentId ?? "nenhum"})`,
        );
      } else {
        console.error(`✗ ${issue.worker}: sem versão ativa observável`);
      }
    }
    throw new Error(
      `produção não corresponde exatamente ao último baseline legado observado (${issues.length} diferença(s))`,
    );
  }

  if (snapshotOut) {
    const snapshot = {
      kind: "pre-activation-live-snapshot",
      capturedAt: new Date().toISOString(),
      historicalSourceCommit: baseline.sourceCommit,
      workers: observed,
    };
    await writeFile(snapshotOut, JSON.stringify(snapshot, null, 2) + "\n");
    console.log(`snapshot pré-ativação gravado em ${snapshotOut}`);
  }

  console.log(
    `✓ produção corresponde exatamente ao baseline histórico ${baseline.sourceCommit.slice(0, 12)}.`,
  );
  return observed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const baselineArg = arg("--baseline", "state/legacy-production-baseline.json");
    const outArg = arg("--out");
    await verifyLegacyProduction({
      baselinePath: resolve(root, baselineArg),
      snapshotOut: outArg ? resolve(root, outArg) : null,
    });
  } catch (error) {
    console.error(`\nAtivação bloqueada. ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
