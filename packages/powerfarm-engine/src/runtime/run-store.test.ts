import { describe, expect, it } from "vitest";
import type { PowerfarmDatabase } from "./session-service.js";
import { RunStore } from "./run-store.js";

class FakeRunDatabase implements PowerfarmDatabase {
  row: Record<string, unknown> | undefined;
  checkpoints = 0;

  async rpc(name: string, params: Record<string, unknown>): Promise<unknown> {
    if (name === "powerfarm_run_create") {
      this.row ??= {
        id: "00000000-0000-4000-8000-000000000001",
        gadget_id: params.p_gadget_id,
        gadget_version: params.p_gadget_version,
        definition_hash: params.p_definition_hash,
        engine_ref: params.p_session_id,
        idempotency_key: params.p_idempotency_key,
        status: "created",
        result: null,
        error: null,
      };
      this.checkpoints ||= 1;
      return structuredClone(this.row);
    }
    if (name === "powerfarm_run_get") return this.row ? structuredClone(this.row) : null;
    if (name === "powerfarm_run_transition") {
      if (!this.row) throw new Error("missing");
      const expected = params.p_expected as string[];
      if (!expected.includes(String(this.row.status)) && this.row.status !== params.p_next) {
        throw new Error("invalid transition");
      }
      if (this.row.status !== params.p_next) this.checkpoints += 1;
      this.row.status = params.p_next;
      this.row.result = params.p_result;
      this.row.error = params.p_error;
      return structuredClone(this.row);
    }
    throw new Error(`Unexpected RPC ${name}`);
  }
}

const create = {
  gadgetId: "hello-agentic",
  gadgetVersion: "0.1.0",
  definitionHash: "b".repeat(64),
  sessionId: "session-1",
  idempotencyKey: "invoke-1",
  intent: "say hello",
};

describe("durable run store", () => {
  it("creates one idempotent run and compare-and-set transitions with checkpoints", async () => {
    const database = new FakeRunDatabase();
    const store = new RunStore(database);
    const first = await store.create(create);
    const repeated = await store.create(create);
    expect(repeated.id).toBe(first.id);
    expect(database.checkpoints).toBe(1);

    await expect(store.transition(first.id, ["created"], "running", { turn: 1 }))
      .resolves.toMatchObject({ status: "running" });
    await expect(store.transition(first.id, ["created"], "completed", {}, null, { ok: true }))
      .rejects.toThrow(/transition/i);
    expect(database.checkpoints).toBe(2);
  });
});
