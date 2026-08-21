#!/usr/bin/env node
// REGRA 8 — recuperação. E ela SÓ é declarada boa depois de um novo smoke.
//
// Cloudflare pode RECUSAR um rollback: se houve mudança de ciclo de vida de
// Durable Object, ou se recursos ligados à versão antiga não existem mais.
// Por isso aqui não se anuncia vitória por exit code 0 do wrangler.
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const i = process.argv.indexOf("--from");
const verificar = process.argv.includes("--verify");
const onlyIdx = process.argv.indexOf("--only-workers");
const onlyWorkers = new Set(
  (onlyIdx > -1 ? process.argv[onlyIdx + 1] ?? "" : "")
    .split(",").map((value) => value.trim()).filter(Boolean),
);
const registro = JSON.parse(await readFile(`${root}/${i > -1 ? process.argv[i + 1] : "versoes-antes.json"}`, "utf8"));

// Ordem inversa da publicação: a origem pública volta primeiro, para parar de
// servir código novo contra workers que ainda vão voltar atrás.
const ordem = Object.entries(registro.workers).reverse().filter(([worker]) =>
  onlyWorkers.size === 0 || onlyWorkers.has(worker));

const recusados = [];
for (const [worker, ponto] of ordem) {
  if (!ponto?.versionId) {
    console.log(`- ${worker}: sem ponto de volta (worker novo), deixando como está`);
    continue;
  }
  console.log(`- ${worker}: revertendo para ${ponto.versionId.slice(0, 8)}`);
  const r = spawnSync("pnpm", [
    "exec", "wrangler", "rollback", ponto.versionId,
    "--name", worker, "--message", "recuperação automática", "--yes",
  ], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) recusados.push(worker);
}

if (recusados.length) {
  console.error(`\n✗ Cloudflare recusou o rollback em: ${recusados.join(", ")}`);
  console.error("  Causa provável: mudança de ciclo de vida de Durable Object,");
  console.error("  ou recurso ligado à versão antiga que não existe mais.");
  console.error("  ISTO PRECISA DE VOCÊ. Dashboard > Workers > worker > Deployments.");
  process.exit(1);
}

if (!verificar) {
  console.log("\n✓ Comandos de rollback aceitos. (sem --verify: NÃO confirmado no ar)");
  process.exit(0);
}

// A parte que faltava: provar que voltou.
console.log("\nConfirmando que a instância voltou ao ar...");
const url = process.env.PUBLIC_URL ?? "";
const smoke = spawnSync("node", [`${root}/scripts/smoke-test.mjs`, url], { cwd: root, stdio: "inherit" });
if (smoke.status !== 0) {
  console.error("\n✗ Rollback executado, mas a instância CONTINUA fora do ar.");
  console.error("  Não é mais um problema de deploy. Vá olhar agora.");
  process.exit(1);
}
console.log("\n✓ Recuperado e confirmado: a instância voltou ao estado anterior ao merge.");
