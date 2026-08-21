#!/usr/bin/env node
// REGRA 2 — migration destrutiva de Durable Object precisa de aprovação
// VINCULADA AO CONTEÚDO EXATO. Aprovar "workshop-backend:v17" e depois alguém
// mudar o que a v17 faz, mantendo a tag, não pode continuar valendo.
//
// Roda sem nenhum secret.
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonc, readJson, sha256, fail, pass } from "../lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DESTRUTIVO = ["renamed_classes", "deleted_classes", "renamed_class", "deleted_class"];

const aprovacoes = readJson(`${root}/state/migrations-approved.json`)?.approved ?? [];
const porChave = new Map(aprovacoes.map((a) => [`${a.package}:${a.tag}`, a]));

// Fonte + artefato gerado: uma migration pode entrar pelo gerador sem estar
// no wrangler.jsonc do pacote, então os dois são varridos.
const raizes = [`${root}/cloudflare-os/packages`, `${root}/packages`].filter(existsSync);
const arquivos = [];
for (const dir of raizes) {
  for (const pkg of await readdir(dir)) {
    for (const nome of ["wrangler.jsonc", "wrangler.prod.jsonc"]) {
      const p = `${dir}/${pkg}/${nome}`;
      if (existsSync(p)) arquivos.push({ pkg, path: p, gerado: nome.includes("prod") });
    }
  }
}

let destrutivas = 0, aprovadas = 0;
for (const { pkg, path, gerado } of arquivos) {
  for (const m of (await readJsonc(path)).migrations ?? []) {
    const campos = DESTRUTIVO.filter((k) => m[k]);
    if (!campos.length) continue;
    destrutivas++;

    const digest = sha256(JSON.stringify(m, Object.keys(m).sort()));
    const chave = `${pkg}:${m.tag}`;
    const ap = porChave.get(chave);

    if (!ap) {
      fail("REGRA 2", `migration destrutiva SEM aprovação: ${chave}${gerado ? " (no artefato gerado)" : ""}`,
        `  campos: ${campos.join(", ")}\n` +
        `  Isto apaga ou renomeia classes de Durable Object. Os dados NÃO voltam.\n` +
        `  wrangler rollback reverte código, não dados — e pode até ser recusado\n` +
        `  quando há mudança de ciclo de vida de DO.\n\n` +
        `  Para liberar, acrescente em state/migrations-approved.json:\n` +
        `    { "package": ${JSON.stringify(pkg)}, "tag": ${JSON.stringify(m.tag)},\n` +
        `      "migrationDigest": ${JSON.stringify(digest)},\n` +
        `      "approvedAt": "AAAA-MM-DD", "reason": "por que é seguro perder isto" }`);
      continue;
    }
    if (ap.migrationDigest !== digest) {
      fail("REGRA 2", `a migration ${chave} MUDOU depois de aprovada`,
        `  aprovado: ${ap.migrationDigest ?? "(sem digest — aprovação antiga, inválida)"}\n` +
        `  agora:    ${digest}\n` +
        `  Mesma tag, conteúdo diferente. A aprovação anterior não vale.`);
      continue;
    }
    if (!ap.approvedAt || !ap.reason) {
      fail("REGRA 2", `aprovação de ${chave} está incompleta`, `  approvedAt e reason são obrigatórios.`);
      continue;
    }
    aprovadas++;
    console.log(`  (aprovada ${ap.approvedAt}) ${chave} — ${ap.reason}`);
  }
}

if (!process.exitCode) {
  pass("REGRA 2", destrutivas
    ? `${aprovadas} migration(s) destrutiva(s), todas aprovadas pelo conteúdo`
    : "nenhuma migration destrutiva");
}
