import type { PowerfarmDatabase } from "./session-service.js";
import { isRecord } from "./json.js";

export type RunStatus = "created" | "running" | "waiting_input" | "completed" | "failed" | "cancelled";

export interface RunRecord {
  id: string;
  gadgetId: string;
  gadgetVersion: string;
  definitionHash: string;
  sessionId: string;
  idempotencyKey: string;
  runGrantId?: string;
  status: RunStatus;
  result: unknown;
  error: unknown;
  checkpoint?: unknown;
}

export interface CreateRunInput {
  gadgetId: string;
  gadgetVersion: string;
  definitionHash: string;
  sessionId: string;
  idempotencyKey: string;
  intent: string;
  runGrantRef?: string;
}

const runStatuses = new Set<RunStatus>([
  "created", "running", "waiting_input", "completed", "failed", "cancelled",
]);

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Invalid run field ${key}`);
  return value;
}

function asRun(value: unknown): RunRecord {
  if (!isRecord(value)) throw new Error("Invalid run database response");
  const status = value.status;
  if (typeof status !== "string" || !runStatuses.has(status as RunStatus)) {
    throw new Error("Invalid run status");
  }
  return {
    id: stringField(value, "id"),
    gadgetId: stringField(value, "gadget_id"),
    gadgetVersion: stringField(value, "gadget_version"),
    definitionHash: stringField(value, "definition_hash"),
    sessionId: stringField(value, "engine_ref"),
    idempotencyKey: stringField(value, "idempotency_key"),
    runGrantId: typeof value.run_grant_id === "string" ? value.run_grant_id : undefined,
    status: status as RunStatus,
    result: value.result,
    error: value.error,
    checkpoint: value.checkpoint,
  };
}

export class RunStore {
  constructor(private readonly database: PowerfarmDatabase) {}

  async create(input: CreateRunInput): Promise<RunRecord> {
    if (input.idempotencyKey.trim() === "") throw new Error("An idempotency key is required");
    if (input.runGrantRef !== undefined) {
      return asRun(await this.database.rpc("powerfarm_run_create_envelope", {
        p_run_grant_ref: input.runGrantRef,
        p_session_id: input.sessionId,
        p_intent: input.intent,
      }));
    }
    return asRun(await this.database.rpc("powerfarm_run_create", {
      p_gadget_id: input.gadgetId,
      p_gadget_version: input.gadgetVersion,
      p_definition_hash: input.definitionHash,
      p_session_id: input.sessionId,
      p_idempotency_key: input.idempotencyKey,
      p_intent: input.intent,
    }));
  }

  async get(runId: string): Promise<RunRecord | undefined> {
    const response = await this.database.rpc("powerfarm_run_get", { p_run_id: runId });
    return response === null ? undefined : asRun(response);
  }

  async transition(
    runId: string,
    expected: RunStatus[],
    next: RunStatus,
    state: Record<string, unknown> = {},
    pendingInput: unknown = null,
    result: unknown = null,
    error: unknown = null,
  ): Promise<RunRecord> {
    return asRun(await this.database.rpc("powerfarm_run_transition", {
      p_run_id: runId,
      p_expected: expected,
      p_next: next,
      p_state: state,
      p_pending_input: pendingInput,
      p_result: result,
      p_error: error,
    }));
  }
}
