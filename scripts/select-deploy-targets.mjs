#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const DEPLOYMENT_ORDER = [
  "errorReporter", "context", "scheduler", "customGatekeeper", "engine", "identity",
  "workshop", "router",
];

const FULL_DEPLOY_FILES = new Set([
  "deployment.jsonc",
  "package.json",
  "pnpm-lock.yaml",
  "state/esperado.json",
  "cloudflare-os",
]);

function isNonRuntimeFile(path) {
  return path === "README.md" || path.startsWith("docs/") || path.startsWith(".github/")
    || path.endsWith(".md");
}

/**
 * Convert a git diff into the smallest safe Worker deployment set.
 * Unknown runtime-affecting paths deliberately fall back to a full deployment.
 */
export function selectDeploymentTargets(files) {
  const targets = new Set();
  let full = false;

  for (const raw of files) {
    const path = raw.trim();
    if (!path || isNonRuntimeFile(path)) continue;

    if (FULL_DEPLOY_FILES.has(path)
      || path === "scripts/deploy-powerfarm.mjs"
      || path === "scripts/lib.mjs") {
      full = true;
      continue;
    }

    if (path.startsWith("packages/gatekeeper-identity/")) targets.add("identity");
    else if (path.startsWith("packages/powerfarm-engine/")) targets.add("engine");
    else if (path.startsWith("packages/custom-gatekeeper/")) targets.add("customGatekeeper");
    else if (path.startsWith("packages/error-reporter/")) targets.add("errorReporter");
    else if (path.startsWith("scripts/") || path.startsWith("state/")) {
      // CI/guard/smoke-only edits do not alter Worker bytes or topology.
    } else {
      // A new runtime path should never silently skip production convergence.
      full = true;
    }
  }

  return full ? [...DEPLOYMENT_ORDER] : DEPLOYMENT_ORDER.filter((name) => targets.has(name));
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function gitDiffFiles(base, head) {
  if (!base || !head || /^0+$/.test(base)) return null;
  const exists = spawnSync("git", ["cat-file", "-e", `${base}^{commit}`], { cwd: root });
  if (exists.status !== 0) {
    const fetched = spawnSync("git", ["fetch", "--quiet", "--no-tags", "--depth=1", "origin", base],
      { cwd: root, stdio: "inherit" });
    if (fetched.status !== 0) return null;
  }
  const diff = spawnSync("git", ["diff", "--name-only", `${base}..${head}`], {
    cwd: root, encoding: "utf8",
  });
  if (diff.status !== 0) return null;
  return diff.stdout.split(/\r?\n/).filter(Boolean);
}

async function workerNames(targets) {
  const deployment = parse(await readFile(resolve(root, "deployment.jsonc"), "utf8"), [], {
    allowTrailingComma: true,
  });
  return targets.map((target) => deployment?.workers?.[target]?.name).filter(Boolean);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = gitDiffFiles(arg("--base"), arg("--head"));
  const targets = files === null ? [...DEPLOYMENT_ORDER] : selectDeploymentTargets(files);
  if (process.argv.includes("--worker-names")) {
    process.stdout.write((await workerNames(targets)).join(",") || "none");
  } else {
    process.stdout.write(targets.join(",") || "none");
  }
}
