import assert from "node:assert/strict";
import test from "node:test";
import { compareProductionBaseline } from "./verify-legacy-production.mjs";

const expected = {
  "worker-a": { deploymentId: "deploy-a", versionId: "version-a" },
  "worker-b": { deploymentId: "deploy-b", versionId: "version-b" },
};

test("exact legacy production snapshot passes with no issues", () => {
  assert.deepEqual(compareProductionBaseline(expected, structuredClone(expected)), []);
});

test("version drift is reported even when deployment id is unchanged", () => {
  const observed = structuredClone(expected);
  observed["worker-b"].versionId = "different-version";

  assert.deepEqual(
    compareProductionBaseline(expected, observed).map((issue) => [issue.kind, issue.worker]),
    [["version", "worker-b"]],
  );
});

test("deployment drift is reported even when the active version is unchanged", () => {
  const observed = structuredClone(expected);
  observed["worker-a"].deploymentId = "different-deployment";

  assert.deepEqual(
    compareProductionBaseline(expected, observed).map((issue) => [issue.kind, issue.worker]),
    [["deployment", "worker-a"]],
  );
});

test("worker-set changes block activation", () => {
  const observed = { "worker-a": expected["worker-a"] };
  const issues = compareProductionBaseline(expected, observed);

  assert.equal(issues[0].kind, "worker-set");
  assert.equal(issues.some((issue) => issue.worker === "worker-b"), true);
});
