import { describe, expect, it, vi } from "vitest";
import type { PowerfarmDatabase } from "./session-service.js";
import { EffectStore } from "./effect-store.js";

class FakeEffectDatabase implements PowerfarmDatabase {
  effect: Record<string, unknown> | undefined;

  async rpc(name: string, params: Record<string, unknown>): Promise<unknown> {
    if (name === "powerfarm_effect_claim") {
      if (!this.effect) {
        this.effect = {
          id: "00000000-0000-4000-8000-000000000002",
          request_hash: params.p_request_hash,
          status: "claimed",
          result: null,
        };
        return { decision: "execute", effect: structuredClone(this.effect) };
      }
      if (this.effect.request_hash !== params.p_request_hash) throw new Error("different effect input");
      return {
        decision: this.effect.status === "completed" ? "replay" : "blocked",
        effect: structuredClone(this.effect),
      };
    }
    if (name === "powerfarm_effect_complete") {
      if (!this.effect) throw new Error("missing");
      this.effect.status = "completed";
      this.effect.result = structuredClone(params.p_result);
      return structuredClone(this.effect);
    }
    if (name === "powerfarm_effect_uncertain") {
      if (!this.effect) throw new Error("missing");
      this.effect.status = "uncertain";
      return structuredClone(this.effect);
    }
    throw new Error(`Unexpected RPC ${name}`);
  }
}

describe("effect idempotency", () => {
  it("executes once and replays the committed result for the same request", async () => {
    const database = new FakeEffectDatabase();
    const store = new EffectStore(database);
    const execute = vi.fn(async () => ({ externalId: "one" }));
    const input = {
      runId: "00000000-0000-4000-8000-000000000001",
      gadgetId: "hello-agentic",
      capabilityId: "notify",
      idempotencyKey: "effect-1",
      request: { message: "hello" },
    };

    await expect(store.perform(input, execute)).resolves.toEqual({ externalId: "one" });
    await expect(store.perform(input, execute)).resolves.toEqual({ externalId: "one" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("marks a timed-out external effect uncertain and never retries it automatically", async () => {
    const database = new FakeEffectDatabase();
    const store = new EffectStore(database);
    const execute = vi.fn(async () => { throw new Error("timeout after send"); });
    const input = {
      runId: "00000000-0000-4000-8000-000000000001",
      gadgetId: "hello-agentic",
      capabilityId: "notify",
      idempotencyKey: "effect-2",
      request: { message: "hello" },
    };
    await expect(store.perform(input, execute)).rejects.toThrow(/timeout/);
    await expect(store.perform(input, execute)).rejects.toThrow(/not safe to retry/i);
    expect(execute).toHaveBeenCalledOnce();
  });
});
