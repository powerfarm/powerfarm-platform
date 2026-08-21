import type { CapabilityBindings } from "./runtime/compile-adk.js";
import {
  PowerfarmInvocationRuntime,
  type InvocationResult,
  type InvokeRequest,
  type ResumeRequest,
} from "./runtime/invocation.js";
import { isRecord } from "./runtime/json.js";
import { RunStore } from "./runtime/run-store.js";
import type { PowerfarmDatabase } from "./runtime/session-service.js";
import { createPowerfarmDatabase, PowerfarmAuthenticationError } from "./runtime/supabase.js";
import { WorkersAiModelCapability, type WorkersAiBinding } from "./runtime/workers-ai.js";

export interface EngineEnv {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  WORKERS_AI_MODEL: string;
  AI: WorkersAiBinding;
}

export interface InvocationApi {
  invoke(request: InvokeRequest): Promise<InvocationResult>;
  resume(request: ResumeRequest): Promise<InvocationResult>;
}

type DatabaseFactory = (config: {
  url: string; publishableKey: string; callerBearer: string;
}) => Promise<PowerfarmDatabase>;

interface HttpDependencies {
  gadgets: Record<string, string>;
  databaseFactory?: DatabaseFactory;
  bindingsFactory?: (env: EngineEnv) => CapabilityBindings;
  runtimeFactory?: (
    database: PowerfarmDatabase, source: string, bindings: CapabilityBindings,
  ) => InvocationApi;
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

function response(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || header.length <= 7 || header.length > 16_384) {
    throw new HttpError(401, "authentication_required");
  }
  return header.slice(7);
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "application_json_required");
  }
  const announced = Number(request.headers.get("content-length") ?? 0);
  if (announced > 64_000) throw new HttpError(413, "request_too_large");
  const source = await request.text();
  if (source.length > 64_000) throw new HttpError(413, "request_too_large");
  try {
    const value: unknown = JSON.parse(source);
    if (!isRecord(value) || !("input" in value)) throw new HttpError(400, "input_required");
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_json");
  }
}

const defaultBindings = (env: EngineEnv): CapabilityBindings => ({
  models: { model: new WorkersAiModelCapability(env.AI, env.WORKERS_AI_MODEL) },
  codeExecutors: {},
  tools: {},
});

export function createHttpHandler(dependencies: HttpDependencies): {
  fetch(request: Request, env: EngineEnv): Promise<Response>;
} {
  const databaseFactory = dependencies.databaseFactory ?? createPowerfarmDatabase;
  const bindingsFactory = dependencies.bindingsFactory ?? defaultBindings;
  const runtimeFactory = dependencies.runtimeFactory
    ?? ((database, source, bindings) => new PowerfarmInvocationRuntime(database, source, bindings));

  return {
    async fetch(request, env): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/healthz") {
        return response({ ok: true, service: "pf.engine", compute: "disposable" });
      }

      try {
        const token = bearer(request);
        const invokeMatch = url.pathname.match(/^\/v1\/gadgets\/([a-z][a-z0-9-]*)\/invocations$/);
        const resumeMatch = url.pathname.match(/^\/v1\/runs\/([0-9a-f-]+)\/resume$/i);
        const runMatch = url.pathname.match(/^\/v1\/runs\/([0-9a-f-]+)$/i);

        if (request.method === "POST" && invokeMatch) {
          const gadgetId = invokeMatch[1];
          const source = gadgetId === undefined ? undefined : dependencies.gadgets[gadgetId];
          if (source === undefined) throw new HttpError(404, "gadget_not_found");
          const idempotencyKey = request.headers.get("idempotency-key")?.trim();
          if (!idempotencyKey || idempotencyKey.length > 200) {
            throw new HttpError(400, "valid_idempotency_key_required");
          }
          const payload = await body(request);
          const database = await databaseFactory({
            url: env.SUPABASE_URL,
            publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
            callerBearer: token,
          });
          const runtime = runtimeFactory(database, source, bindingsFactory(env));
          const result = await runtime.invoke({
            userId: "authenticated", input: payload.input, idempotencyKey,
          });
          return response(result, result.status === "waiting_input" ? 202 : 200);
        }

        if (request.method === "POST" && resumeMatch) {
          const payload = await body(request);
          const database = await databaseFactory({
            url: env.SUPABASE_URL,
            publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
            callerBearer: token,
          });
          const source = dependencies.gadgets["hello-agentic"];
          if (source === undefined) throw new HttpError(404, "gadget_not_found");
          const runtime = runtimeFactory(database, source, bindingsFactory(env));
          const result = await runtime.resume({
            userId: "authenticated", runId: resumeMatch[1] ?? "", input: payload.input,
          });
          return response(result, result.status === "waiting_input" ? 202 : 200);
        }

        if (request.method === "GET" && runMatch) {
          const database = await databaseFactory({
            url: env.SUPABASE_URL,
            publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
            callerBearer: token,
          });
          const run = await new RunStore(database).get(runMatch[1] ?? "");
          if (!run) throw new HttpError(404, "run_not_found");
          return response(run);
        }

        throw new HttpError(404, "not_found");
      } catch (error) {
        if (error instanceof HttpError) return response({ error: error.code }, error.status);
        if (error instanceof PowerfarmAuthenticationError) {
          return response({ error: "authentication_failed" }, 401);
        }
        // Never reflect provider/database errors: they can contain request or
        // credential details. Operational detail belongs in sanitized telemetry.
        return response({ error: "internal_error" }, 500);
      }
    },
  };
}
