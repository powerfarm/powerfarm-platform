import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("activation workflow is one-shot, Identity-only, and preserves credential boundaries", async () => {
  const workflow = await readFile(
    resolve(root, ".github/workflows/activate-production-baseline.yml"),
    "utf8",
  );

  assert.match(workflow, /paths:\s*\n\s*- state\/activation-request\.json/);
  assert.match(workflow, /request\.requested === true/);
  assert.match(workflow, /productionBaselineActivated === true/);
  assert.match(workflow, /productionDeployControllerEnabled !== false/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /activate:[\s\S]*permissions:\s*\n\s*contents: write\s*\n\s*issues: write/);

  assert.match(workflow, /deployment\.jsonc/,
    "Cloudflare account id must be resolved from canonical deployment source");
  assert.match(workflow, /cfg\?\.accountId/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID=\$ACCOUNT_ID/);
  assert.doesNotMatch(workflow, /secrets\.CLOUDFLARE_ACCOUNT_ID/,
    "activation must not duplicate account id as a secret");

  assert.match(workflow, /verify-legacy-production\.mjs --out versoes-antes\.json/);
  assert.match(workflow, /check-drift\.mjs --esperado state\/esperado\.json --ignore-workers/);
  assert.match(workflow, /packages\/gatekeeper-identity exec wrangler deploy --config wrangler\.prod\.jsonc/);
  assert.doesNotMatch(workflow, /\bpnpm deploy\b/);

  const accountIndex = workflow.indexOf("CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID");
  const verifyIndex = workflow.indexOf("verify-legacy-production.mjs");
  const deployIndex = workflow.indexOf("packages/gatekeeper-identity exec wrangler deploy");
  const anchorIndex = workflow.indexOf("GITHUB_SHA=\"$CANONICAL_RUNTIME_COMMIT\" node scripts/record-versions.mjs");
  const finalizeIndex = workflow.indexOf("node scripts/finalize-production-activation.mjs");
  const stateCheckIndex = workflow.indexOf("node scripts/check-production-migration-state.mjs");
  const pushIndex = workflow.indexOf("git push \"https://x-access-token:${GH_PUSH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git\" HEAD:main");
  const rollbackIndex = workflow.indexOf("node scripts/rollback.mjs --from versoes-antes.json");
  assert.ok(accountIndex >= 0 && verifyIndex > accountIndex,
    "canonical account id must be resolved before the first Cloudflare API proof");
  assert.ok(verifyIndex >= 0 && deployIndex > verifyIndex,
    "exact live baseline proof must happen before the first production write");
  assert.ok(anchorIndex > deployIndex,
    "durable Git anchor must happen only after the Identity write and its proofs");
  assert.ok(finalizeIndex > anchorIndex,
    "tested state finalization must happen after live versions are recorded");
  assert.ok(stateCheckIndex > finalizeIndex && pushIndex > stateCheckIndex,
    "finalized migration state must validate before the anchor commit is pushed");
  assert.ok(rollbackIndex > pushIndex,
    "anchor/finalization/push failure must still flow into automatic Identity rollback");

  const readOnlyOccurrences = workflow.match(/CLOUDFLARE_API_TOKEN_READONLY/g) ?? [];
  assert.ok(readOnlyOccurrences.length >= 3,
    "version proof, drift proof and final readback should use the read-only token");
  assert.match(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);

  assert.match(workflow, /select-deploy-targets\.mjs --base "\$CANONICAL" --head "\$GITHUB_SHA"/);
  assert.match(workflow, /if \[ "\$EXTRA" != "none" \]/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}[\s\S]*gh api "repos\/\$\{GITHUB_REPOSITORY\}\/commits\/main" --jq \.sha/);
  assert.match(workflow, /test "\$CURRENT" = "\$GITHUB_SHA"/);
  assert.doesNotMatch(workflow, /git fetch --quiet origin main/);
  assert.match(workflow, /GITHUB_SHA="\$CANONICAL_RUNTIME_COMMIT" node scripts\/record-versions\.mjs/);
  assert.match(workflow, /node scripts\/finalize-production-activation\.mjs/);
  assert.match(workflow, /node scripts\/check-production-migration-state\.mjs/);
});
