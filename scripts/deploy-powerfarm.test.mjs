import assert from "node:assert/strict";
import test from "node:test";
import { configDaIdentity, configDoEngine, deploymentOrder } from "./deploy-powerfarm.mjs";

test("deploys Engine before the sole Gatekeeper that binds its named RPC entrypoint", () => {
  assert.ok(deploymentOrder.indexOf("engine") < deploymentOrder.indexOf("identity"));
  assert.equal(deploymentOrder.at(-1), "router");
});

test("generates an independent disposable Engine without a second state or loader topology", () => {
  const generated = configDoEngine({
    compatibility_date: "2026-02-02",
    compatibility_flags: ["nodejs_compat", "nodejs_compat_do_not_populate_process_env"],
    main: "src/index.ts",
  }, {
    accountId: "account",
    workers: { engine: { name: "powerfarm-engine", route: { workersDev: true } } },
    agenticRuntime: {
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKeySecret: "SUPABASE_PUBLISHABLE_KEY",
      workersAiModel: "@cf/model",
    },
    observability: {
      enabled: true, headSamplingRate: 1,
      logs: { invocationLogs: false }, traces: { enabled: false, headSamplingRate: 0.1 },
    },
  });

  assert.equal(generated.name, "powerfarm-engine");
  assert.equal(generated.workers_dev, true);
  assert.deepEqual(generated.ai, { binding: "AI" });
  assert.deepEqual(generated.vars, {
    SUPABASE_URL: "https://project.supabase.co", WORKERS_AI_MODEL: "@cf/model",
  });
  assert.deepEqual(generated.secrets, { required: ["SUPABASE_PUBLISHABLE_KEY"] });
  assert.equal(generated.durable_objects, undefined);
  assert.equal(generated.d1_databases, undefined);
  assert.equal(generated.worker_loaders, undefined);
  assert.equal(JSON.stringify(generated).includes("service_role"), false);
});

test("gives only Identity Gatekeeper the narrow named Engine binding", () => {
  const generated = configDaIdentity({
    name: "identity", vars: { ISSUER: "https://issuer" },
    migrations: [{ tag: "v0", new_sqlite_classes: ["UserAccount"] }],
  }, {
    accountId: "account",
    workers: {
      identity: { name: "powerfarm-gk-identity" },
      engine: { name: "powerfarm-engine" },
    },
    agenticRuntime: {
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKeySecret: "SUPABASE_PUBLISHABLE_KEY",
    },
    observability: {
      enabled: true, headSamplingRate: 1,
      logs: { invocationLogs: false }, traces: { enabled: false, headSamplingRate: 0.1 },
    },
  });

  assert.deepEqual(generated.services, [{
    binding: "ENGINE", service: "powerfarm-engine", entrypoint: "WorkspaceRuntime",
  }]);
  assert.equal(generated.vars.SUPABASE_URL, "https://project.supabase.co");
  assert.deepEqual(generated.secrets.required.sort(), ["CLIENT_SECRET", "SUPABASE_PUBLISHABLE_KEY"]);
  assert.deepEqual(generated.migrations.at(-1), {
    tag: "v1", new_sqlite_classes: ["PowerfarmGatekeeper"],
  });
});
