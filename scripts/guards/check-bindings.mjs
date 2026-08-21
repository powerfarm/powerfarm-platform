#!/usr/bin/env node
// REGRA 3 — nenhum binding pode SUMIR nem TROCAR DE ALVO silenciosamente.
//
// Comparação semântica por tripla (nome + tipo + alvo). "GATEKEEPER_LINEAR
// existe" não basta: ele tem que apontar para o worker certo.
//
// Referência: state/takeover.json, o registro do que a produção tinha quando
// assumimos. Roda sem secret nenhum.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonc, readDeployment, readJson, generatedConfigPaths,
         normalizeGenerated, tripleKey, SEGREDOS, fail, pass } from "../lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const config = await readDeployment(root);
// Instalação limpa: o repo sempre foi a fonte da verdade, então a referência é
// o último estado esperado commitado. Se ainda não existe (primeiro deploy),
// não há o que perder e a regra passa.
const takeover = readJson(`${root}/state/esperado.json`);
if (!takeover) {
  pass("REGRA 3", "primeiro deploy: não há estado anterior para perder");
  process.exit(0);
}

const caminhos = generatedConfigPaths(config);
let conferidos = 0;

for (const [worker, foto] of Object.entries(takeover.workers)) {
  const rel = caminhos[worker];
  if (!rel) continue;                       // worker fora do escopo deste repo
  const path = `${root}/${rel}`;
  if (!existsSync(path)) { fail("REGRA 3", `config gerado ausente para ${worker}: ${rel}`); continue; }

  const gerado = normalizeGenerated(await readJsonc(path));
  const geradas = new Map(gerado.bindings.map((b) => [b.name, b]));
  conferidos++;

  const sumindo = [], trocando = [];
  for (const b of foto.bindings ?? []) {
    if (SEGREDOS.has(b.type)) continue;     // segredos sobrevivem ao deploy, não vêm do config
    const g = geradas.get(b.name);
    if (!g) { sumindo.push(b); continue; }
    if (tripleKey(g) !== tripleKey(b)) trocando.push({ antes: b, agora: g });
  }

  const critico = (n) => n.startsWith("GATEKEEPER_");
  if (sumindo.length) {
    const gk = sumindo.map((b) => b.name).filter(critico);
    fail("REGRA 3", `${worker} perderia ${sumindo.length} binding(s)`,
      sumindo.map((b) => `    - ${b.name} (${b.type} -> ${b.target ?? "—"})`).join("\n") +
      (gk.length
        ? `\n  CRÍTICO: ${gk.join(", ")}\n` +
          `  O router acha gatekeeper escaneando GATEKEEPER_*. Sem o binding,\n` +
          `  /gatekeeper/<nome>/ não dá 404: cai no SPA e devolve 200. O connector\n` +
          `  morre e a borda parece saudável.`
        : ""));
  }
  if (trocando.length) {
    fail("REGRA 3", `${worker} mudaria o alvo de ${trocando.length} binding(s)`,
      trocando.map(({ antes, agora }) =>
        `    - ${antes.name}\n        antes: ${antes.type} -> ${antes.target ?? "—"}` +
        `\n        agora: ${agora.type} -> ${agora.target ?? "—"}`).join("\n"));
  }
}

if (!process.exitCode) pass("REGRA 3", `${conferidos} worker(s) mantêm nome, tipo e alvo de todos os bindings`);
