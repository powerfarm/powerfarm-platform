import {
  Runner,
  createResumabilityConfig,
  isFinalResponse,
  type Event,
  type Session,
} from "../adk.js";
import { compileGadgetYaml, type CompiledGadget } from "../contracts/gadget.js";
import { compileAdkGadget, type CapabilityBindings } from "./compile-adk.js";
import { isRecord, safeError, sha256Json } from "./json.js";
import { RunStore, type RunRecord } from "./run-store.js";
import { SupabaseSessionService, type PowerfarmDatabase } from "./session-service.js";

export interface InvokeRequest {
  userId: string;
  input: unknown;
  idempotencyKey: string;
  runGrantRef?: string;
}

export interface ResumeRequest {
  userId: string;
  runId: string;
  input: unknown;
  idempotencyKey?: string;
}

export interface PendingInput {
  callId: string;
  name: "adk_request_input";
  message: string;
  responseSchema?: unknown;
}

export interface InvocationResult {
  runId: string;
  sessionId: string;
  status: "waiting_input" | "completed";
  pendingInput?: PendingInput;
  result?: { text: string };
  provenance: {
    gadgetId: string;
    gadgetVersion: string;
    definitionHash: string;
    gadgetRevision?: number;
    gadgetRevisionHash?: string;
    capabilityRef?: string;
    authorityVersion?: number;
    runtime: "adk-js@1.6.0";
  };
}

function pendingFromEvent(event: Event): PendingInput | undefined {
  const longRunningIds = new Set(event.longRunningToolIds ?? []);
  for (const part of event.content?.parts ?? []) {
    if (!("functionCall" in part) || part.functionCall === undefined) continue;
    const call = part.functionCall;
    if (call.name !== "adk_request_input" || typeof call.id !== "string" || !longRunningIds.has(call.id)) continue;
    const args = isRecord(call.args) ? call.args : {};
    if (typeof args.message !== "string") throw new Error("ADK input request omitted its message");
    return {
      callId: call.id,
      name: "adk_request_input",
      message: args.message,
      responseSchema: args.responseSchema,
    };
  }
  return undefined;
}

function pendingFromRun(run: RunRecord): PendingInput | undefined {
  if (!isRecord(run.checkpoint) || !isRecord(run.checkpoint.pending_input)) return undefined;
  const pending = run.checkpoint.pending_input;
  if (typeof pending.callId !== "string" || pending.name !== "adk_request_input"
    || typeof pending.message !== "string") return undefined;
  return {
    callId: pending.callId,
    name: "adk_request_input",
    message: pending.message,
    responseSchema: pending.responseSchema,
  };
}

function completedResult(run: RunRecord): { text: string } | undefined {
  return isRecord(run.result) && typeof run.result.text === "string"
    ? { text: run.result.text }
    : undefined;
}

function inputText(input: unknown): string {
  return typeof input === "string" ? input : JSON.stringify(input);
}

export class PowerfarmInvocationRuntime {
  constructor(
    private readonly database: PowerfarmDatabase,
    private readonly gadgetSource: string,
    private readonly bindings: CapabilityBindings,
  ) {}

  private provenance(gadget: CompiledGadget): InvocationResult["provenance"] {
    return {
      gadgetId: gadget.id,
      gadgetVersion: gadget.version,
      definitionHash: gadget.definitionHash,
      runtime: "adk-js@1.6.0",
    };
  }

  private existingResult(gadget: CompiledGadget, run: RunRecord): InvocationResult | undefined {
    if (run.status === "waiting_input") {
      const pendingInput = pendingFromRun(run);
      if (!pendingInput) throw new Error("Waiting run has no durable input checkpoint");
      return {
        runId: run.id, sessionId: run.sessionId, status: "waiting_input",
        pendingInput, provenance: this.provenance(gadget),
      };
    }
    if (run.status === "completed") {
      const result = completedResult(run);
      if (!result) throw new Error("Completed run has no durable result");
      return {
        runId: run.id, sessionId: run.sessionId, status: "completed",
        result, provenance: this.provenance(gadget),
      };
    }
    return undefined;
  }

  private services(gadget: CompiledGadget): {
    sessionService: SupabaseSessionService;
    runStore: RunStore;
  } {
    return {
      sessionService: new SupabaseSessionService(this.database, {
        gadgetId: gadget.id,
        gadgetVersion: gadget.version,
        definitionHash: gadget.definitionHash,
      }),
      runStore: new RunStore(this.database),
    };
  }

  private async execute(
    gadget: CompiledGadget,
    run: RunRecord,
    session: Session,
    message: { role: "user"; parts: Array<Record<string, unknown>> },
  ): Promise<InvocationResult> {
    const { rootAgent } = compileAdkGadget(gadget, this.bindings);
    const { sessionService, runStore } = this.services(gadget);
    const runner = new Runner({
      appName: gadget.id,
      agent: rootAgent,
      sessionService,
      resumabilityConfig: createResumabilityConfig({ isResumable: true }),
    });
    let pendingInput: PendingInput | undefined;
    let text = "";
    try {
      for await (const event of runner.runAsync({
        userId: session.userId,
        sessionId: session.id,
        newMessage: message,
      })) {
        pendingInput ??= pendingFromEvent(event);
        if (isFinalResponse(event)) {
          for (const part of event.content?.parts ?? []) {
            if ("text" in part && typeof part.text === "string") text += part.text;
          }
        }
      }

      const reloaded = await sessionService.getSession({
        appName: gadget.id, userId: session.userId, sessionId: session.id,
      });
      const state = reloaded?.state ?? session.state;
      if (pendingInput) {
        await runStore.transition(run.id, ["running"], "waiting_input", state, pendingInput);
        return {
          runId: run.id, sessionId: session.id, status: "waiting_input",
          pendingInput, provenance: this.provenance(gadget),
        };
      }
      const result = { text };
      await runStore.transition(run.id, ["running"], "completed", state, null, result);
      return {
        runId: run.id, sessionId: session.id, status: "completed",
        result, provenance: this.provenance(gadget),
      };
    } catch (error) {
      await runStore.transition(run.id, ["running"], "failed", session.state, null, null, safeError(error));
      throw error;
    }
  }

  async invoke(request: InvokeRequest): Promise<InvocationResult> {
    const gadget = await compileGadgetYaml(this.gadgetSource);
    // Resolve all capability authority before recording or starting the run.
    compileAdkGadget(gadget, this.bindings);
    const { sessionService, runStore } = this.services(gadget);
    const sessionId = `session-${sha256Json({ gadgetId: gadget.id, key: request.idempotencyKey }).slice(0, 32)}`;
    const run = await runStore.create({
      gadgetId: gadget.id,
      gadgetVersion: gadget.version,
      definitionHash: gadget.definitionHash,
      sessionId,
      idempotencyKey: request.idempotencyKey,
      runGrantRef: request.runGrantRef,
      intent: inputText(request.input),
    });
    const existing = this.existingResult(gadget, run);
    if (existing) return existing;
    if (run.status !== "created") throw new Error(`Run ${run.id} cannot be invoked from ${run.status}`);

    const session = await sessionService.getOrCreateSession({
      appName: gadget.id, userId: request.userId, sessionId, state: {},
    });
    const running = await runStore.transition(run.id, ["created"], "running", session.state);
    return this.execute(gadget, running, session, {
      role: "user", parts: [{ text: inputText(request.input) }],
    });
  }

  async resume(request: ResumeRequest): Promise<InvocationResult> {
    const gadget = await compileGadgetYaml(this.gadgetSource);
    compileAdkGadget(gadget, this.bindings);
    const { sessionService, runStore } = this.services(gadget);
    const run = await runStore.get(request.runId);
    if (!run) throw new Error("Run not found");
    if (run.gadgetId !== gadget.id || run.definitionHash !== gadget.definitionHash) {
      throw new Error("Run does not belong to this Gadget definition");
    }
    if (run.status === "completed") return this.existingResult(gadget, run) as InvocationResult;
    if (run.status !== "waiting_input") throw new Error(`Run ${run.id} cannot resume from ${run.status}`);
    const pending = pendingFromRun(run);
    if (!pending) throw new Error("Waiting run has no durable input checkpoint");
    const session = await sessionService.getSession({
      appName: gadget.id, userId: request.userId, sessionId: run.sessionId,
    });
    if (!session) throw new Error("Durable ADK session not found");
    const running = await runStore.transition(run.id, ["waiting_input"], "running", session.state);
    return this.execute(gadget, running, session, {
      role: "user",
      parts: [{ functionResponse: {
        id: pending.callId,
        name: pending.name,
        response: { input: request.input },
      } }],
    });
  }
}
