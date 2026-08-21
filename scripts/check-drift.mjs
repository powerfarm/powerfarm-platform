#!/usr/bin/env node
// REGRA 1 — produção tem que bater com uma referência declarada pelo repo.
//
// Uso normal (drift diário): state/esperado.json atual.
// Uso antes de deploy: --esperado aponta para o esperado do ÚLTIMO commit
// realmente implantado. Isso detecta mudança manual na produção sem impedir
// que o novo commit declare mudanças legítimas ainda não implantadas.
//
// Um deploy seletivo pode usar --ignore-workers para excluir somente os Workers
// que serão reconciliados neste próprio run. Todo o resto continua protegido
// pelo baseline anterior.
import { writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, cfFetch, normalizeLive, tripleKey, SEGREDOS } from "./lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const relIdx = process.argv.indexOf("--relatorio");
const relatorio = relIdx > -1 ? process.argv[relIdx + 1] : null;
const espIdx = process.argv.indexOf("--esperado");
const espArg = espIdx > -1 ? process.argv[espIdx + 1] : "state/esperado.json";
const ignoreIdx = process.argv.indexOf("--ignore-workers");
const ignoredWorkers = new Set(
  (ignoreIdx > -1 ? process.argv[ignoreIdx + 1] ?? "" : "")
    .split(",").map((value) => value.trim()).filter(Boolean),
);
if (!espArg) {
  console.error("✗ REGRA 1 — --esperado exige um caminho.");
  process.exit(1);
}
const esperadoPath = isAbsolute(espArg) ? espArg : resolve(root, espArg);

const esperado = readJson(esperadoPath);
if (!esperado?.workers || !Object.keys(esperado.workers).length) {
  console.error(`✗ REGRA 1 — referência esperada inválida ou vazia: ${esperadoPath}`);
  process.exit(1);
}

// Estes Gatekeepers são instaláveis pelo fluxo oficial do Cloudflare OS e
// aparecem como bindings dinâmicos no backend/router. Eles não pertencem ao
// contrato estático deste repo: o usuário pode habilitar/desabilitar conectores
// sem um deploy do Powerfarm. A lista é fechada de propósito; um novo binding
// upstream volta a bloquear a REGRA 1 até ser revisado explicitamente.
const GATEKEEPERS_GERENCIADOS_PELO_DEPLOY_SERVICE = new Set([
  "GATEKEEPER_CLOUDFLARE",
  "GATEKEEPER_CONFLUENCE",
  "GATEKEEPER_EMAIL",
  "GATEKEEPER_GITHUB",
  "GATEKEEPER_GOOGLE",
  "GATEKEEPER_HOMEASSISTANT",
  "GATEKEEPER_LINEAR",
  "GATEKEEPER_MCP_PORTAL",
  "GATEKEEPER_MCP",
  "GATEKEEPER_NOTION",
  "GATEKEEPER_SLACK",
  "GATEKEEPER_SPOTIFY",
  "GATEKEEPER_SUPABASE",
  "GATEKEEPER_ZOOMINFO",
]);

function extraGerenciadoEmRuntime(worker, nome) {
  if ((worker === "powerfarm-backend" || worker === "powerfarm") &&
      GATEKEEPERS_GERENCIADOS_PELO_DEPLOY_SERVICE.has(nome)) return true;
  if (worker === "powerfarm-backend" && nome === "PUBLIC_BASE_URL") return true;
  if ((worker === "powerfarm-gk-context" || worker === "powerfarm-gk-scheduler") &&
      nome === "BASE_URL") return true;
  return false;
}

const linhas = [];
const anotar = (s) => { linhas.push(s); console.error(s); };
let divergiu = false;

// A referência define o conjunto que precisa existir. Não usamos o deployment
// NOVO aqui: se ele adicionar/remover Workers, isso é justamente a mudança que
// ainda será aplicada depois que o baseline anterior for validado.
for (const worker of Object.keys(esperado.workers)) {
  if (ignoredWorkers.has(worker)) {
    console.log(`↷ ${worker}: drift pré-deploy ignorado porque este Worker será reconciliado agora`);
    continue;
  }

  const vivo = normalizeLive(await cfFetch(`/workers/scripts/${worker}/settings`));
  const alvo = esperado.workers[worker];

  if (vivo.missing) { divergiu = true; anotar(`- ${worker}: NÃO EXISTE na conta`); continue; }

  // Segredos e bindings injetados fora do repo não entram na comparação:
  // o repo não os declara, então não pode "esperá-los".
  const vivos = new Map(vivo.bindings.filter((b) => !SEGREDOS.has(b.type)).map((b) => [b.name, b]));
  const alvos = new Map(alvo.bindings.map((b) => [b.name, b]));

  for (const [nome, esp] of alvos) {
    const real = vivos.get(nome);
    if (!real) { divergiu = true; anotar(`- ${worker}: binding ${nome} sumiu da produção`); continue; }
    if (tripleKey(real) !== tripleKey(esp)) {
      divergiu = true;
      anotar(`- ${worker}: binding ${nome} aponta para outro lugar`);
      anotar(`    esperado: ${esp.type} -> ${esp.target ?? "(sem alvo)"}`);
      anotar(`    produção: ${real.type} -> ${real.target ?? "(sem alvo)"}`);
    } else if (esp.text !== undefined && real.text !== esp.text) {
      divergiu = true;
      anotar(`- ${worker}: var ${nome} mudou em produção`);
      anotar(`    esperado: ${esp.text}`);
      anotar(`    produção: ${real.text}`);
    }
  }
  for (const nome of vivos.keys()) {
    if (!alvos.has(nome) && !extraGerenciadoEmRuntime(worker, nome)) {
      divergiu = true;
      anotar(`- ${worker}: binding ${nome} existe em produção mas a referência não o declara`);
    }
  }
  if (vivo.compatibility_date !== alvo.compatibility_date) {
    divergiu = true;
    anotar(`- ${worker}: compatibility_date ${vivo.compatibility_date} != ${alvo.compatibility_date}`);
  }
}

if (relatorio) {
  const relatorioPath = isAbsolute(relatorio) ? relatorio : resolve(root, relatorio);
  await writeFile(relatorioPath, linhas.join("\n") + "\n");
}

if (divergiu) {
  console.error("\n✗ REGRA 1 — produção divergiu da referência declarada.");
  console.error(`  referência: ${esperadoPath}`);
  console.error("  Corrija via PR/deploy; não reaprenda o estado a partir da produção.\n");
  process.exit(1);
}
const ignored = ignoredWorkers.size ? `; reconciliando agora: ${[...ignoredWorkers].join(", ")}` : "";
console.log(`✓ REGRA 1 — produção bate com a referência (${esperadoPath}${ignored}).`);
