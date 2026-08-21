#!/usr/bin/env node
// REGRA 7 — grava o ponto de volta ANTES de qualquer ativação.
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readDeployment, ownedWorkers, cfFetch } from "./lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const i = process.argv.indexOf("--out");
const out = i > -1 ? process.argv[i + 1] : "versoes-antes.json";

const registro = { gravadoEm: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? null, workers: {} };
for (const nome of ownedWorkers(await readDeployment(root))) {
  const d = await cfFetch(`/workers/scripts/${nome}/deployments`);
  const atual = d?.deployments?.[0];
  registro.workers[nome] = atual
    ? { deploymentId: atual.id, versionId: atual.versions?.[0]?.version_id ?? null }
    : null;
  console.log(`  ${nome}: ${registro.workers[nome]?.versionId?.slice(0, 8) ?? "(sem deployment)"}`);
}
await writeFile(`${root}/${out}`, JSON.stringify(registro, null, 2) + "\n");
console.log(`\nPonto de volta gravado em ${out}`);
