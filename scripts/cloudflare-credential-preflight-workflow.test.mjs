import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("credential preflight can authenticate but cannot write Cloudflare", async () => {
  const workflow = await readFile(
    resolve(root, ".github/workflows/cloudflare-credential-preflight.yml"),
    "utf8",
  );
  const request = JSON.parse(
    await readFile(resolve(root, "state/credential-preflight-request.json"), "utf8"),
  );

  assert.equal(typeof request.requested, "boolean", "preflight request must be explicit");
  assert.match(workflow, /request\.requested === true/,
    "workflow gate must require an explicit true request before credential access");
  assert.match(workflow, /request\.requested = false/,
    "successful preflight must disarm its own request");
  assert.match(workflow, /paths:\s*\n\s*- state\/credential-preflight-request\.json/);
  assert.match(workflow, /environment: producao/);

  assert.match(workflow, /deployment\.jsonc/,
    "Cloudflare account id must come from canonical deployment source");
  assert.match(workflow, /cfg\?\.accountId/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID=\$ACCOUNT_ID/);
  assert.doesNotMatch(workflow, /secrets\.CLOUDFLARE_ACCOUNT_ID/,
    "account id is configuration, not a duplicated secret");

  assert.match(workflow, /CLOUDFLARE_API_TOKEN_READONLY/);
  assert.match(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /check-cloudflare-api-read\.mjs --worker powerfarm-backend/);
  assert.match(workflow, /verify-legacy-production\.mjs/);

  assert.doesNotMatch(workflow, /wrangler deploy/);
  assert.doesNotMatch(workflow, /\bpnpm deploy\b/);
  assert.doesNotMatch(workflow, /scripts\/rollback\.mjs/);
  assert.doesNotMatch(workflow, /workers\/scripts\/[^\s]+\/content/);

  assert.match(workflow, /accountIdFromDeploymentSource: true/);
  assert.match(workflow, /deploymentTokenApiRead: true/);
  assert.match(workflow, /deploymentTokenWriteScopeVerified: false/);
  assert.match(workflow, /historicalEightWorkerBaselineStillExact: true/);
  assert.match(workflow, /No Cloudflare write was attempted/);
});
