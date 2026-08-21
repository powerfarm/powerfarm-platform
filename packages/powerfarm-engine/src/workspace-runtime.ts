import type { CapabilityBindings } from "./runtime/compile-adk.js";
import { compileGadgetYaml } from "./contracts/gadget.js";
import { parseExecutionEnvelope, verifyExecutionEnvelope } from "./runtime/execution-envelope.js";
import { PowerfarmInvocationRuntime, type InvocationResult } from "./runtime/invocation.js";
import type { PowerfarmDatabase } from "./runtime/session-service.js";
import { createPowerfarmDatabase } from "./runtime/supabase.js";
import { WorkersAiModelCapability } from "./runtime/workers-ai.js";
import type { EngineEnv, InvocationApi } from "./http.js";

type DatabaseFactory = (config: {
  url: string;
  publishableKey: string;
  callerBearer: string;
}) => Promise<PowerfarmDatabase>;

interface WorkspaceRuntimeDependencies {
  databaseFactory?: DatabaseFactory;
  bindingsFactory?: (env: EngineEnv) => CapabilityBindings;
  runtimeFactory?: (
    database: PowerfarmDatabase,
    gadgetSource: string,
    bindings: CapabilityBindings,
  ) => InvocationApi;
}

export interface WorkspaceRuntimeService {
  validateGadget(source: string): Promise<{
    gadgetId: string;
    gadgetVersion: string;
    definitionHash: string;
  }>;
  invokeGadget(
    envelope: unknown,
    delegatedBearer: string,
    env: EngineEnv,
  ): Promise<InvocationResult>;
  resumeRun(
    envelope: unknown,
    delegatedBearer: string,
    env: EngineEnv,
  ): Promise<InvocationResult>;
}

const defaultBindings = (env: EngineEnv): CapabilityBindings => ({
  models: { model: new WorkersAiModelCapability(env.AI, env.WORKERS_AI_MODEL) },
  codeExecutors: {},
  tools: {},
});

function pinProvenance(
  result: InvocationResult,
  envelope: ReturnType<typeof parseExecutionEnvelope>,
): InvocationResult {
  return {
    ...result,
    provenance: {
      ...result.provenance,
      gadgetRevision: envelope.gadgetRevision,
      gadgetRevisionHash: envelope.gadgetRevisionHash,
      capabilityRef: envelope.capabilityRef,
      authorityVersion: envelope.authorityVersion,
    },
  };
}

export function createWorkspaceRuntimeService(
  dependencies: WorkspaceRuntimeDependencies = {},
): WorkspaceRuntimeService {
  const databaseFactory = dependencies.databaseFactory ?? createPowerfarmDatabase;
  const bindingsFactory = dependencies.bindingsFactory ?? defaultBindings;
  const runtimeFactory = dependencies.runtimeFactory
    ?? ((database, source, bindings) => new PowerfarmInvocationRuntime(database, source, bindings));

  return Object.freeze({
    async validateGadget(source: string) {
      const gadget = await compileGadgetYaml(source);
      return {
        gadgetId: gadget.id,
        gadgetVersion: gadget.version,
        definitionHash: gadget.definitionHash,
      };
    },
    async invokeGadget(
      rawEnvelope: unknown,
      delegatedBearer: string,
      env: EngineEnv,
    ): Promise<InvocationResult> {
      if (delegatedBearer.length === 0 || delegatedBearer.length > 16_384) {
        throw new Error("Delegated authentication required");
      }
      const envelope = parseExecutionEnvelope(rawEnvelope);
      await verifyExecutionEnvelope(envelope);
      if (envelope.operation !== "run") throw new Error("Run envelope required");
      const database = await databaseFactory({
        url: env.SUPABASE_URL,
        publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
        callerBearer: delegatedBearer,
      });
      const runtime = runtimeFactory(database, envelope.gadgetSource, bindingsFactory(env));
      return pinProvenance(await runtime.invoke({
        userId: envelope.principalRef,
        input: envelope.input,
        idempotencyKey: envelope.idempotencyKey,
        runGrantRef: envelope.runGrantRef,
      }), envelope);
    },
    async resumeRun(
      rawEnvelope: unknown,
      delegatedBearer: string,
      env: EngineEnv,
    ): Promise<InvocationResult> {
      if (delegatedBearer.length === 0 || delegatedBearer.length > 16_384) {
        throw new Error("Delegated authentication required");
      }
      const envelope = parseExecutionEnvelope(rawEnvelope);
      await verifyExecutionEnvelope(envelope);
      if (envelope.operation !== "resume" || envelope.runRef === undefined) {
        throw new Error("Resume envelope required");
      }
      const database = await databaseFactory({
        url: env.SUPABASE_URL,
        publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
        callerBearer: delegatedBearer,
      });
      const runtime = runtimeFactory(database, envelope.gadgetSource, bindingsFactory(env));
      return pinProvenance(await runtime.resume({
        userId: envelope.principalRef,
        runId: envelope.runRef,
        input: envelope.input,
        idempotencyKey: envelope.idempotencyKey,
      }), envelope);
    },
  });
}
