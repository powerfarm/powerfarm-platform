import assert from "node:assert/strict";
import test from "node:test";
import { createTypesConfig } from "./generate-worker-types.mjs";

test("Worker type config uses source main without executing custom build", () => {
  const original = {
    name: "example",
    main: ".wrangler/validate/src/index.ts",
    build: { command: "dangerous-transform" },
    vars: { EXAMPLE: "value" },
    compatibility_date: "2026-08-04",
  };

  const derived = createTypesConfig(original, "src/index.ts");

  assert.equal(derived.main, "src/index.ts");
  assert.equal("build" in derived, false);
  assert.deepEqual(derived.vars, original.vars);
  assert.equal(derived.compatibility_date, original.compatibility_date);
  assert.equal(original.main, ".wrangler/validate/src/index.ts");
  assert.deepEqual(original.build, { command: "dangerous-transform" });
});
