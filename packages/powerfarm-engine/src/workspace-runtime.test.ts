import { describe, expect, it, vi } from "vitest";
import { compileGadgetYaml } from "./contracts/gadget.js";
import type { InvocationResult } from "./runtime/invocation.js";
import type { PowerfarmDatabase } from "./runtime/session-service.js";
import { createWorkspaceRuntimeService } from "./workspace-runtime.js";

const source = `apiVersion: powerfarm.app/v1alpha1
kind: Gadget
metadata: { id: hello-agentic, version: 0.1.0 }
spec:
  agentic: { runtime: adk-js }
  agents:
    assistant:
      model: { capability: model }
      instruction: Help the user.
      capabilities: [model]
  flows:
    default: { sequence: [{ agent: assistant }] }
  capabilities:
    model: { kind: model, target: workers-ai }
`;

const result: InvocationResult = {
  runId: "00000000-0000-4000-8000-000000000030",
  sessionId: "session-1",
  status: "completed",
  result: { text: "HELLO" },
  provenance: {
    gadgetId: "hello-agentic", gadgetVersion: "0.1.0",
    definitionHash: "a".repeat(64), runtime: "adk-js@1.6.0",
  },
};

async function envelope() {
  const gadget = await compileGadgetYaml(source);
  return {
    envelope_version: "powerfarm.execution/v0.1",
    principal_ref: "00000000-0000-4000-8000-000000000010",
    workspace_ref: "00000000-0000-4000-8000-000000000001",
    capability_ref: "hello.run",
    gadget_ref: "hello-agentic",
    gadget_revision: 1,
    gadget_revision_hash: "b".repeat(64),
    gadget_definition_hash: gadget.definitionHash,
    gadget_version: "0.1.0",
    operation: "run",
    input: { task: "hello" },
    gadget_source: source,
    run_grant_ref: "00000000-0000-4000-8000-000000000020",
    allowed_capabilities: ["model"],
    idempotency_key: "tool-call-1",
    authority_version: 1,
    issued_at: new Date(Date.now() - 60_000).toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
}

describe("WorkspaceRuntime private RPC service", () => {
  it("validates authored source into exact publish metadata without executing it", async () => {
    const service = createWorkspaceRuntimeService();
    const validated = await service.validateGadget(source);
    const compiled = await compileGadgetYaml(source);
    expect(validated).toEqual({
      gadgetId: "hello-agentic", gadgetVersion: "0.1.0",
      definitionHash: compiled.definitionHash,
    });
    await expect(service.validateGadget("kind: not-a-gadget")).rejects.toThrow();
  });

  it("uses bearer only for the caller-scoped database and invokes the exact granted source", async () => {
    const database: PowerfarmDatabase = { rpc: vi.fn() };
    const databaseFactory = vi.fn(async () => database);
    const invoke = vi.fn(async () => result);
    const service = createWorkspaceRuntimeService({
      databaseFactory,
      bindingsFactory: () => ({ models: {}, codeExecutors: {}, tools: {} }),
      runtimeFactory: (_database, gadgetSource) => ({ invoke, resume: vi.fn() }),
    });

    const delegatedBearer = "private-user-jwt";
    const response = await service.invokeGadget(await envelope(), delegatedBearer, {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "publishable",
      WORKERS_AI_MODEL: "@cf/model",
      AI: { run: async () => ({ response: "unused" }) },
    });

    expect(response).toEqual({
      ...result,
      provenance: {
        ...result.provenance,
        gadgetRevision: 1,
        gadgetRevisionHash: "b".repeat(64),
        capabilityRef: "hello.run",
        authorityVersion: 1,
      },
    });
    expect(databaseFactory).toHaveBeenCalledWith({
      url: "https://example.supabase.co", publishableKey: "publishable",
      callerBearer: delegatedBearer,
    });
    expect(invoke).toHaveBeenCalledWith({
      userId: "00000000-0000-4000-8000-000000000010",
      input: { task: "hello" }, idempotencyKey: "tool-call-1",
      runGrantRef: "00000000-0000-4000-8000-000000000020",
    });
    expect(JSON.stringify(await envelope())).not.toContain(delegatedBearer);
  });

  it("resumes the exact durable run named by a resume envelope", async () => {
    const resume = vi.fn(async () => result);
    const service = createWorkspaceRuntimeService({
      databaseFactory: async () => ({ rpc: vi.fn() }),
      bindingsFactory: () => ({ models: {}, codeExecutors: {}, tools: {} }),
      runtimeFactory: () => ({ invoke: vi.fn(), resume }),
    });
    const base = await envelope();
    const resumeEnvelope = {
      ...base,
      operation: "resume",
      run_ref: "00000000-0000-4000-8000-000000000030",
      idempotency_key: "resume-call-1",
    };

    await service.resumeRun(resumeEnvelope, "private-user-jwt", {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "publishable",
      WORKERS_AI_MODEL: "@cf/model",
      AI: { run: async () => ({ response: "unused" }) },
    });

    expect(resume).toHaveBeenCalledWith({
      userId: "00000000-0000-4000-8000-000000000010",
      runId: "00000000-0000-4000-8000-000000000030",
      input: { task: "hello" }, idempotencyKey: "resume-call-1",
    });
  });
});
