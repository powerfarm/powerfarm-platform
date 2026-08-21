import { describe, expect, it, vi } from "vitest";
import type { CapabilityBindings } from "./runtime/compile-adk.js";
import type { InvocationResult } from "./runtime/invocation.js";
import type { PowerfarmDatabase } from "./runtime/session-service.js";
import { createHttpHandler, type EngineEnv, type InvocationApi } from "./http.js";

const completed: InvocationResult = {
  runId: "00000000-0000-4000-8000-000000000001",
  sessionId: "session-1",
  status: "completed",
  result: { text: "hello" },
  provenance: {
    gadgetId: "hello-agentic", gadgetVersion: "0.1.0",
    definitionHash: "a".repeat(64), runtime: "adk-js@1.6.0",
  },
};

function setup() {
  const database: PowerfarmDatabase = {
    rpc: async (name) => name === "powerfarm_run_get" ? {
      id: completed.runId,
      gadget_id: "hello-agentic",
      gadget_version: "0.1.0",
      definition_hash: "a".repeat(64),
      engine_ref: "session-1",
      idempotency_key: "key",
      status: "completed",
      result: { text: "hello" },
      error: null,
    } : null,
  };
  const invoke = vi.fn(async () => completed);
  const resume = vi.fn(async () => completed);
  const api: InvocationApi = { invoke, resume };
  const databaseFactory = vi.fn(async () => database);
  const runtimeFactory = vi.fn(() => api);
  const handler = createHttpHandler({
    gadgets: { "hello-agentic": "valid yaml" },
    databaseFactory,
    runtimeFactory,
    bindingsFactory: () => ({ models: {}, codeExecutors: {}, tools: {} } as CapabilityBindings),
  });
  const env: EngineEnv = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public",
    WORKERS_AI_MODEL: "@cf/test/model",
    AI: { run: async () => ({ response: "unused" }) },
  };
  return { handler, env, invoke, resume, databaseFactory };
}

describe("Powerfarm Engine HTTP", () => {
  it("rejects missing authentication and malformed invocation authority", async () => {
    const { handler, env, databaseFactory } = setup();
    const noAuth = await handler.fetch(new Request("https://engine/v1/gadgets/hello-agentic/invocations", {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": "key" },
      body: JSON.stringify({ input: "hello" }),
    }), env);
    expect(noAuth.status).toBe(401);
    expect(databaseFactory).not.toHaveBeenCalled();

    const noKey = await handler.fetch(new Request("https://engine/v1/gadgets/hello-agentic/invocations", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer jwt" },
      body: JSON.stringify({ input: "hello" }),
    }), env);
    expect(noKey.status).toBe(400);
  });

  it("invokes, reads, and resumes a Gadget through stable routes", async () => {
    const { handler, env, invoke, resume } = setup();
    const headers = {
      "content-type": "application/json", authorization: "Bearer jwt", "idempotency-key": "key",
    };
    const invoked = await handler.fetch(new Request("https://engine/v1/gadgets/hello-agentic/invocations", {
      method: "POST", headers, body: JSON.stringify({ input: "hello" }),
    }), env);
    expect(invoked.status).toBe(200);
    expect(invoke).toHaveBeenCalledWith({ userId: "authenticated", input: "hello", idempotencyKey: "key" });

    const read = await handler.fetch(new Request(`https://engine/v1/runs/${completed.runId}`, {
      headers: { authorization: "Bearer jwt" },
    }), env);
    expect(read.status).toBe(200);

    const resumed = await handler.fetch(new Request(`https://engine/v1/runs/${completed.runId}/resume`, {
      method: "POST", headers, body: JSON.stringify({ input: "Ada" }),
    }), env);
    expect(resumed.status).toBe(200);
    expect(resume).toHaveBeenCalledWith({ userId: "authenticated", runId: completed.runId, input: "Ada" });
  });

  it("returns health without auth, rejects unknown Gadgets, and sanitizes internal errors", async () => {
    const { handler, env } = setup();
    expect((await handler.fetch(new Request("https://engine/healthz"), env)).status).toBe(200);
    const missing = await handler.fetch(new Request("https://engine/v1/gadgets/missing/invocations", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer jwt", "idempotency-key": "key" },
      body: JSON.stringify({ input: "hello" }),
    }), env);
    expect(missing.status).toBe(404);

    const broken = createHttpHandler({
      gadgets: { "hello-agentic": "yaml" },
      databaseFactory: async () => { throw new Error("secret token abc"); },
      runtimeFactory: () => { throw new Error("unused"); },
      bindingsFactory: () => ({ models: {}, codeExecutors: {}, tools: {} }),
    });
    const response = await broken.fetch(new Request("https://engine/v1/gadgets/hello-agentic/invocations", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer jwt", "idempotency-key": "key" },
      body: JSON.stringify({ input: "hello" }),
    }), env);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret token abc");
  });
});
