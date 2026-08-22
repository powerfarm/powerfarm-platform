#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";

export function createTypesConfig(config, sourceMain) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("wrangler config must be an object");
  }
  if (typeof sourceMain !== "string" || !sourceMain.trim()) {
    throw new TypeError("source main is required");
  }

  const typesConfig = structuredClone(config);
  typesConfig.main = sourceMain;
  delete typesConfig.build;
  return typesConfig;
}

export async function generateWorkerTypes({ cwd = process.cwd(), sourceMain }) {
  const configPath = resolve(cwd, "wrangler.jsonc");
  const temporaryConfigPath = resolve(cwd, "wrangler.types.json");
  const errors = [];
  const parsed = parse(await readFile(configPath, "utf8"), errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`invalid wrangler.jsonc: ${errors.length} parse error(s)`);

  const typesConfig = createTypesConfig(parsed, sourceMain);
  await writeFile(temporaryConfigPath, JSON.stringify(typesConfig, null, 2) + "\n");

  try {
    const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const result = spawnSync(
      executable,
      ["exec", "wrangler", "types", "--config", temporaryConfigPath],
      { cwd, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`wrangler types failed with status ${result.status}`);
  } finally {
    await rm(temporaryConfigPath, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    await generateWorkerTypes({ sourceMain: process.argv[2] });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
