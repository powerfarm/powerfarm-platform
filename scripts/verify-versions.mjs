#!/usr/bin/env node
// REGRA 8a — prova que os Workers selecionados mudaram e que os demais
// permaneceram na mesma versão. Isso detecta deploy parcial acidental e também
// impede que um deploy seletivo toque em Workers fora do escopo.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readDeployment, ownedWorkers, readJson, cfFetch } from "./lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const i = process.argv.indexOf("--antes");
const antes = readJson(`${root}/${i > -1 ? process.argv[i + 1] : "versoes-antes.json"}`);
const changedIdx = process.argv.indexOf("--changed-workers");
const changedWorkers = new Set(
  (changedIdx > -1 ? process.argv[changedIdx + 1] ?? "" : "")
    .split(",").map((value) => value.trim()).filter(Boolean),
);

let ruim = 0;
for (const worker of ownedWorkers(await readDeployment(root))) {
  const deployments = await cfFetch(`/workers/scripts/${worker}/deployments`);
  const atual = deployments?.deployments?.[0];
  const versaoAgora = atual?.versions?.[0]?.version_id ?? null;
  const versaoAntes = antes?.workers?.[worker]?.versionId ?? null;

  if (!versaoAgora) {
    ruim++;
    console.error(`✗ ${worker}: sem deployment ativo`);
    continue;
  }

  if (changedWorkers.size === 0) {
    console.log(`✓ ${worker}: ${versaoAgora.slice(0, 8)}`);
    continue;
  }

  if (changedWorkers.has(worker)) {
    if (versaoAntes && versaoAgora === versaoAntes) {
      ruim++;
      console.error(`✗ ${worker}: selecionado para deploy, mas continua em ${versaoAgora.slice(0, 8)}`);
    } else {
      console.log(`✓ ${worker}: atualizado para ${versaoAgora.slice(0, 8)} (era ${versaoAntes?.slice(0, 8) ?? "nenhuma"})`);
    }
  } else if (versaoAntes && versaoAgora !== versaoAntes) {
    ruim++;
    console.error(`✗ ${worker}: mudou fora do escopo (${versaoAntes.slice(0, 8)} -> ${versaoAgora.slice(0, 8)})`);
  } else {
    console.log(`· ${worker}: preservado em ${versaoAgora.slice(0, 8)}`);
  }
}

if (ruim) {
  console.error(`\n✗ REGRA 8a — ${ruim} inconsistência(s) de versão após deploy.`);
  process.exit(1);
}
console.log("\n✓ REGRA 8a — versões ativas correspondem exatamente ao escopo selecionado.");
