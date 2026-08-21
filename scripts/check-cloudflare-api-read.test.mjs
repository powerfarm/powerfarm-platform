import assert from "node:assert/strict";
import test from "node:test";
import { assertDeploymentRead } from "./check-cloudflare-api-read.mjs";

test("Cloudflare deployment read accepts one active deployment and version", () => {
  assert.deepEqual(
    assertDeploymentRead({
      deployments: [{ id: "deployment-1", versions: [{ version_id: "version-1" }] }],
    }, "worker-a"),
    { deploymentId: "deployment-1", versionId: "version-1" },
  );
});

test("Cloudflare deployment read rejects malformed responses", () => {
  assert.throws(() => assertDeploymentRead({}, "worker-a"), /response is invalid/);
  assert.throws(
    () => assertDeploymentRead({ deployments: [{ id: "deployment-1", versions: [] }] }, "worker-a"),
    /no active deployment\/version/,
  );
});
