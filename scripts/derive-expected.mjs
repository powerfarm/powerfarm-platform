#!/usr/bin/env node
// Deriva o ESTADO ESPERADO a partir do repo (configs gerados por `pnpm check`).
// Rode depois de `pnpm check`.
//   node scripts/derive-expected.mjs            -> escreve state/esperado.json
//   node scripts/derive-expected.mjs --check    -> falha se o commitado estiver velho
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readDeployment, readJsonc, readJson, generatedConfigPaths, normalizeGenerated } from "./lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const config = await readDeployment(root);

const esperado = { derivadoDe: "deployment.jsonc + submodule pinado", workers: {} };
for (const [worker, rel] of Object.entries(generatedConfigPaths(config))) {
  const path = `${root}/${rel}`;
  if (!existsSync(path)) {
    console.error(`✗ config gerado ausente para ${worker}: ${rel}\n  Rode \`pnpm check\` antes.`);
    process.exit(1);
  }
  esperado.workers[worker] = normalizeGenerated(await readJsonc(path));
}

const texto = JSON.stringify(esperado, null, 2) + "\n";
const destino = `${root}/state/esperado.json`;

if (!check) {
  await writeFile(destino, texto);
  console.log(`estado esperado derivado: ${Object.keys(esperado.workers).length} workers`);
  process.exit(0);
}

const commitado = readJson(destino);
if (JSON.stringify(commitado) === JSON.stringify(esperado)) {
  console.log("✓ state/esperado.json está em dia com o repo");
  process.exit(0);
}
console.error("\n✗ state/esperado.json está desatualizado.");
console.error("  Rode: pnpm check && node scripts/derive-expected.mjs");
console.error("  E commite o resultado — é ele que a vigia diária usa.\n");
process.exit(1);
