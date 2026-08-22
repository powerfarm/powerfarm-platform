import type { PowerfarmDatabase } from "./session-service.js";
import { isRecord, safeError, sha256Json } from "./json.js";

export interface EffectInput {
  runId: string;
  gadgetId: string;
  capabilityId: string;
  idempotencyKey: string;
  request: unknown;
}

interface EffectClaim {
  decision: "execute" | "replay" | "blocked";
  id: string;
  result: unknown;
}

function asClaim(value: unknown): EffectClaim {
  if (!isRecord(value) || !isRecord(value.effect)) throw new Error("Invalid effect-claim response");
  const { decision } = value;
  if (decision !== "execute" && decision !== "replay" && decision !== "blocked") {
    throw new Error("Invalid effect-claim decision");
  }
  if (typeof value.effect.id !== "string") throw new Error("Invalid effect id");
  return { decision, id: value.effect.id, result: value.effect.result };
}

export class EffectInFlightError extends Error {
  constructor() {
    super("Effect is uncertain or in flight; it is not safe to retry automatically");
    this.name = "EffectInFlightError";
  }
}

export class EffectStore {
  constructor(private readonly database: PowerfarmDatabase) {}

  async perform<T>(input: EffectInput, execute: () => Promise<T>): Promise<T> {
    if (input.idempotencyKey.trim() === "") throw new Error("An effect idempotency key is required");
    const claim = asClaim(await this.database.rpc("powerfarm_effect_claim", {
      p_run_id: input.runId,
      p_gadget_id: input.gadgetId,
      p_capability_id: input.capabilityId,
      p_idempotency_key: input.idempotencyKey,
      p_request_hash: sha256Json(input.request),
    }));

    if (claim.decision === "replay") return structuredClone(claim.result) as T;
    if (claim.decision === "blocked") throw new EffectInFlightError();

    try {
      const result = await execute();
      await this.database.rpc("powerfarm_effect_complete", {
        p_effect_id: claim.id,
        p_result: result,
      });
      return result;
    } catch (error) {
      await this.database.rpc("powerfarm_effect_uncertain", {
        p_effect_id: claim.id,
        p_error: safeError(error),
      });
      throw error;
    }
  }
}
