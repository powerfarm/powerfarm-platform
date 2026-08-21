#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const state = JSON.parse(readFileSync("state/starter-upstream.json", "utf8"));
const REQUIRED_REPO = "cloudflare/cloudflare-os-starter";

if (state.repository !== REQUIRED_REPO || state.ref !== "main") {
  console.error("✗ REGRA 0a — fonte do starter não é a oficial.");
  process.exit(1);
}

const r = spawnSync("git", ["hash-object", "scripts/deploy.mjs"], { encoding: "utf8" });
if (r.status !== 0) {
  console.error(r.stderr || "git hash-object falhou");
  process.exit(1);
}
const atual = r.stdout.trim();
if (atual !== state.deployScriptBlob) {
  console.error("✗ REGRA 0a — scripts/deploy.mjs foi alterado fora da sincronização do starter.");
  console.error(`  esperado: ${state.deployScriptBlob}`);
  console.error(`  atual:    ${atual}`);
  process.exit(1);
}

console.log(`✓ REGRA 0a — starter oficial selado em ${atual.slice(0, 12)}.`);
