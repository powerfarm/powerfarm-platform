#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const REQUIRED = "https://github.com/cloudflare/cloudflare-os.git";
const gitmodules = readFileSync(".gitmodules", "utf8");
const url = gitmodules.match(/^\s*url\s*=\s*(.+)\s*$/m)?.[1]?.trim();

if (url !== REQUIRED) {
  console.error("✗ REGRA 0 — cloudflare-os deve apontar para o upstream oficial.");
  console.error(`  esperado: ${REQUIRED}`);
  console.error(`  atual:    ${url ?? "(ausente)"}`);
  process.exit(1);
}

if (!existsSync("cloudflare-os/.git") && !existsSync("cloudflare-os/package.json")) {
  console.error("✗ REGRA 0 — submodule cloudflare-os não foi materializado.");
  process.exit(1);
}

const git = (...args) => {
  const r = spawnSync("git", ["-C", "cloudflare-os", ...args], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || `git ${args.join(" ")} falhou`);
    process.exit(1);
  }
  return r.stdout.trim();
};

const origin = git("remote", "get-url", "origin");
if (origin !== REQUIRED) {
  console.error("✗ REGRA 0 — checkout materializado veio de outro origin.");
  console.error(`  esperado: ${REQUIRED}`);
  console.error(`  atual:    ${origin}`);
  process.exit(1);
}

const pin = git("rev-parse", "HEAD");
console.log(`✓ REGRA 0 — upstream oficial fixado em ${pin.slice(0, 12)}.`);
