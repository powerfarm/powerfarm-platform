#!/usr/bin/env node
// REGRA 8b — a borda pública responde de verdade.
//
// Critério importa: esta checagem dispara rollback automático, então um teste
// severo demais derruba deploy saudável. O que cada endpoint faz quando está BOM:
//   /                     200 com o HTML do app
//   /api                  resposta do backend (não o SPA)
//   /gatekeeper/<nome>/   qualquer coisa que NÃO seja o SPA
//
// A lista de gatekeepers não é mantida à mão: deriva dos GATEKEEPER_* que o
// estado esperado diz estarem bindados no router. Assim um connector novo não
// pode entrar em produção sem automaticamente entrar no smoke.
import { readDeployment, readJson } from "./lib.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base) { console.error("✗ REGRA 8b — defina POWERFARM_PUBLIC_URL."); process.exit(1); }

const deployment = await readDeployment(root);
const esperado = readJson(`${root}/state/esperado.json`);
const routerName = deployment.workers?.router?.name;
const router = esperado?.workers?.[routerName];
if (!router) {
  console.error(`✗ REGRA 8b — router ${routerName ?? "(sem nome)"} não existe em state/esperado.json.`);
  process.exit(1);
}

const derivados = (router.bindings ?? [])
  .filter((b) => b.type === "service" && b.name?.startsWith("GATEKEEPER_"))
  .map((b) => b.name.slice("GATEKEEPER_".length).toLowerCase().replaceAll("_", "-"));

const gatekeepers = (process.env.POWERFARM_GATEKEEPERS
  ? process.env.POWERFARM_GATEKEEPERS.split(",").map((s) => s.trim()).filter(Boolean)
  : derivados);

if (!gatekeepers.length) {
  console.error("✗ REGRA 8b — nenhum GATEKEEPER_* encontrado no router esperado.");
  process.exit(1);
}

async function pegar(path, tentativas = 3) {
  for (let t = 1; t <= tentativas; t++) {
    try {
      const res = await fetch(`${base}${path}`, { redirect: "manual", signal: AbortSignal.timeout(20000) });
      return { status: res.status, corpo: await res.text().catch(() => "") };
    } catch (e) {
      if (t === tentativas) return { status: 0, erro: e.message, corpo: "" };
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

let assinaturaSpa = null;
const tituloDe = (c) => (c.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "").trim();
const ehSpa = (c) => assinaturaSpa !== null && c.length > 0 && tituloDe(c) === assinaturaSpa;
let ruim = 0;

const raiz = await pegar("/");
if (raiz.status === 200 && /<!DOCTYPE html/i.test(raiz.corpo)) assinaturaSpa = tituloDe(raiz.corpo);
if (raiz.status === 200 && assinaturaSpa !== null) console.log("✓ origem pública — 200, app servido");
else if ([301, 302, 401, 403].includes(raiz.status)) {
  ruim++; console.error(`✗ origem pública — ${raiz.status}, algo está interceptando antes do worker`);
} else { ruim++; console.error(`✗ origem pública — ${raiz.status || raiz.erro}`); }

const api = await pegar("/api");
if (api.status === 0) { ruim++; console.error(`✗ backend via /api — sem resposta (${api.erro})`); }
else if (ehSpa(api.corpo)) { ruim++; console.error("✗ backend via /api — devolveu o SPA: o router não está mandando /api para o backend"); }
else console.log(`✓ backend via /api — ${api.status} (${api.corpo.slice(0, 48).trim() || "sem corpo"})`);

for (const nome of gatekeepers) {
  const r = await pegar(`/gatekeeper/${nome}/`);
  if (r.status === 0) { ruim++; console.error(`✗ gatekeeper ${nome} — sem resposta`); continue; }
  if (ehSpa(r.corpo)) {
    ruim++;
    console.error(`✗ gatekeeper ${nome} — devolveu o SPA: o binding GATEKEEPER_${nome.toUpperCase().replace(/-/g, "_")} NÃO existe.`);
    console.error("    O connector está morto e a borda parecia saudável.");
    continue;
  }
  console.log(`✓ gatekeeper ${nome} — ${r.status}, resposta do próprio worker (bindado)`);
}

if (ruim) { console.error(`\n✗ REGRA 8b — ${ruim} verificação(ões) falharam.`); process.exit(1); }
console.log(`\n✓ REGRA 8b — borda pública coerente; ${gatekeepers.length} gatekeeper(s) verificado(s): ${gatekeepers.join(", ")}.`);
