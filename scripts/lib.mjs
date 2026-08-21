// Utilitários compartilhados. Única dependência: jsonc-parser.
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "jsonc-parser";

export async function readJsonc(path) {
  const errors = [];
  const value = parse(await readFile(path, "utf8"), errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`JSONC inválido em ${path}`);
  return value;
}
export const readDeployment = (root) => readJsonc(`${root}/deployment.jsonc`);
export const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
export const sha256 = (s) => "sha256:" + createHash("sha256").update(s).digest("hex").slice(0, 32);

/** Workers que ESTE repo declara possuir. Nada fora disto é tocado nem vigiado. */
export const ownedWorkers = (config) =>
  Object.values(config.workers ?? {}).map((w) => w?.name).filter((n) => typeof n === "string" && n);

/** Onde o deploy.mjs escreve cada config gerado, por nome de worker. */
export function generatedConfigPaths(config) {
  const G = "wrangler.prod.jsonc";
  const mapa = {
    workshop: `cloudflare-os/packages/workshop-backend/${G}`,
    context: `cloudflare-os/packages/gatekeeper-context/${G}`,
    scheduler: `cloudflare-os/packages/gatekeeper-scheduler/${G}`,
    router: `cloudflare-os/packages/router/${G}`,
    customGatekeeper: `packages/custom-gatekeeper/${G}`,
    identity: `packages/gatekeeper-identity/${G}`,
    errorReporter: `packages/error-reporter/${G}`,
    engine: `packages/powerfarm-engine/${G}`,
  };
  const saida = {};
  for (const [chave, rel] of Object.entries(mapa)) {
    const nome = config.workers?.[chave]?.name;
    if (nome) saida[nome] = rel;
  }
  return saida;
}

export async function cfFetch(path) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) throw new Error("faltam CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Cloudflare API ${res.status} em ${path}`);
  const body = await res.json();
  return body.success ? body.result : null;
}

/**
 * TRIPLA SEMÂNTICA: nome + tipo + alvo.
 * "GATEKEEPER_LINEAR existe" não basta; ele tem que apontar para o worker certo.
 */
export function bindingTriple(b) {
  const alvo = b.service ?? b.namespace_id ?? b.bucket_name ?? b.class_name
            ?? b.index_name ?? b.queue_name ?? b.database_id ?? null;
  const t = { name: b.name, type: b.type, target: alvo ?? null };
  if (b.type === "service" && b.entrypoint) t.entrypoint = b.entrypoint;
  // A Cloudflare tipa var de array/objeto como "json" e string como "plain_text".
  // Normalizamos os dois para o mesmo formato textual, senão ADMINS (um array)
  // aparece como json de um lado e plain_text do outro e a tripla nunca bate.
  if (b.type === "plain_text") t.text = b.text;
  if (b.type === "json") t.text = JSON.stringify(b.json);
  return t;
}
export const tripleKey = (t) => `${t.name}|${t.type}|${t.target ?? ""}`;
export const SEGREDOS = new Set(["secret_text", "secret_key", "secrets_store_secret"]);

/** Forma estável e diffável do estado VIVO de um worker. */
export function normalizeLive(settings) {
  if (!settings) return { missing: true };
  return {
    compatibility_date: settings.compatibility_date ?? null,
    compatibility_flags: [...(settings.compatibility_flags ?? [])].sort(),
    migration_tag: settings.migrations?.new_tag ?? null,
    bindings: (settings.bindings ?? []).map(bindingTriple)
      .sort((a, b) => tripleKey(a).localeCompare(tripleKey(b))),
  };
}

/**
 * Mesma forma, derivada de um wrangler.prod.jsonc gerado — ou seja, do REPO.
 * É isto que faz o repo ser a fonte da verdade: o esperado é função do que está
 * commitado, não uma fotografia da produção.
 */
export function normalizeGenerated(cfg) {
  const bindings = [];
  const add = (name, type, target, extra = {}) =>
    bindings.push({ name, type, target: target ?? null, ...extra });

  for (const s of cfg.services ?? []) add(s.binding, "service", s.service, s.entrypoint ? { entrypoint: s.entrypoint } : {});
  for (const k of cfg.kv_namespaces ?? []) add(k.binding, "kv_namespace", k.id ?? k.namespace_id);
  for (const r of cfg.r2_buckets ?? []) add(r.binding, "r2_bucket", r.bucket_name);
  for (const d of cfg.d1_databases ?? []) add(d.binding, "d1", d.database_id);
  for (const q of cfg.queues?.producers ?? []) add(q.binding, "queue", q.queue);
  for (const o of cfg.durable_objects?.bindings ?? []) add(o.name, "durable_object_namespace", o.class_name);
  for (const [nome, valor] of Object.entries(cfg.vars ?? {})) {
    const ehTexto = typeof valor === "string";
    add(nome, ehTexto ? "plain_text" : "json", null,
        { text: ehTexto ? valor : JSON.stringify(valor) });
  }
  if (cfg.browser?.binding) add(cfg.browser.binding, "browser", null);
  if (cfg.ai?.binding) add(cfg.ai.binding, "ai", null);
  if (cfg.assets?.binding) add(cfg.assets.binding, "assets", null);
  for (const w of cfg.worker_loaders ?? []) add(w.binding, "worker_loader", null);

  return {
    compatibility_date: cfg.compatibility_date ?? null,
    compatibility_flags: [...(cfg.compatibility_flags ?? [])].sort(),
    migration_tag: (cfg.migrations ?? []).at(-1)?.tag ?? null,
    bindings: bindings.sort((a, b) => tripleKey(a).localeCompare(tripleKey(b))),
  };
}

let houveFalha = false;
export function fail(regra, mensagem, detalhe = "") {
  houveFalha = true;
  process.exitCode = 1;
  console.error(`\n✗ ${regra}\n  ${mensagem}${detalhe ? "\n" + detalhe : ""}`);
}
export const pass = (regra, mensagem) => console.log(`✓ ${regra} — ${mensagem}`);
export const falhou = () => houveFalha;
