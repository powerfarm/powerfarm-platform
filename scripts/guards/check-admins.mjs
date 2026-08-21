#!/usr/bin/env node
// REGRA 4 — você continua admin, provado NO FONTE E NO ARTEFATO GERADO.
// Não basta o deployment.jsonc estar certo: um bug no gerador produziria um
// wrangler.prod.jsonc errado e a regra passaria feliz. Os dois têm que concordar.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonc, readDeployment, readJson, generatedConfigPaths, fail, pass } from "../lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const config = await readDeployment(root);
const dono = process.env.POWERFARM_OWNER_EMAIL;

const lista = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : [v]; }
  catch { return v.split(/[,\s]+/).filter(Boolean); }
};

// ---- 1. o fonte
const fonte = config.admins ?? [];
if (!Array.isArray(fonte) || fonte.length === 0) {
  fail("REGRA 4", "admins está vazio — ninguém abriria o /admin");
} else if (!fonte.every((e) => typeof e === "string" && e.trim().length > 0)) {
  fail("REGRA 4", `admins tem entrada inválida: ${JSON.stringify(fonte)}`);
} else if (dono && !fonte.includes(dono)) {
  fail("REGRA 4", `${dono} não está em admins`, `  atual: ${fonte.join(", ")}`);
}

// ---- 2. o artefato que de fato vai subir
const rel = generatedConfigPaths(config)[config.workers?.workshop?.name];
if (!rel) {
  fail("REGRA 4", "workers.workshop.name não está definido no deployment.jsonc");
} else if (!existsSync(`${root}/${rel}`)) {
  fail("REGRA 4", `config gerado ausente: ${rel}`, "  Rode `pnpm check` antes deste guard.");
} else {
  const gerado = lista((await readJsonc(`${root}/${rel}`)).vars?.ADMINS);
  if (!gerado.length) {
    fail("REGRA 4", "o artefato gerado não tem ADMINS", `  ${rel} subiria sem nenhum admin.`);
  } else {
    const faltando = fonte.filter((e) => !gerado.includes(e));
    if (faltando.length) {
      fail("REGRA 4", "o gerador perdeu admins pelo caminho",
        `  no deployment.jsonc: ${fonte.join(", ")}\n  no artefato:        ${gerado.join(", ")}\n` +
        `  sumiram: ${faltando.join(", ")}`);
    }
    if (dono && !gerado.includes(dono)) {
      fail("REGRA 4", `${dono} não está no ADMINS do artefato — você perderia o /admin`);
    }
  }
}

// ---- 3. ninguém é removido por acidente
const foto = readJson(`${root}/state/takeover.json`);  // ausente numa instalação limpa
const vivoVar = (foto?.workers?.[config.workers?.workshop?.name]?.bindings ?? [])
  .find((b) => b.name === "ADMINS");
if (vivoVar?.text) {
  const removidos = lista(vivoVar.text).filter((e) => e && !fonte.includes(e));
  if (removidos.length) {
    fail("REGRA 4", `este deploy removeria admin(s) que existem hoje: ${removidos.join(", ")}`,
      "  Se for intencional, faça num commit separado e explícito.");
  }
}

if (!process.exitCode) pass("REGRA 4", `${fonte.length} admin(s) no fonte e no artefato`);
