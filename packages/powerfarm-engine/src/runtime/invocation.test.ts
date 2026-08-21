import { describe, expect, it } from "vitest";
import type { Event, LlmRequest } from "../adk.js";
import type { PowerfarmDatabase } from "./session-service.js";
import { PowerfarmInvocationRuntime } from "./invocation.js";

const source = `
apiVersion: powerfarm.app/v1alpha1
kind: Gadget
metadata: { id: hello-agentic, version: 0.1.0 }
spec:
  agentic: { runtime: adk-js }
  agents:
    assistant:
      model: { capability: model }
      instruction: Ask once, then finish.
      capabilities: [model, input]
  flows:
    default:
      sequence: [{ agent: assistant }]
  capabilities:
    model: { kind: model, target: workers-ai }
    input: { kind: input, target: user }
`;

class DurableFake implements PowerfarmDatabase {
  readonly sessions = new Map<string, Record<string, unknown>>();
  readonly events = new Map<string, Event>();
  readonly runs = new Map<string, Record<string, unknown>>();
  private runSequence = 0;

  async rpc(name: string, p: Record<string, unknown>): Promise<unknown> {
    const sessionKey = `${String(p.p_app_name)}:${String(p.p_session_id)}`;
    if (name === "powerfarm_session_create") {
      const row = this.sessions.get(sessionKey) ?? {
        id: p.p_session_id, app_name: p.p_app_name, user_id: "identity-1",
        state: structuredClone(p.p_state), last_update_time: p.p_last_update_time,
      };
      this.sessions.set(sessionKey, row);
      return { ...structuredClone(row), events: [] };
    }
    if (name === "powerfarm_session_get") {
      const row = this.sessions.get(sessionKey);
      return row ? { ...structuredClone(row), events: [...this.events.values()] } : null;
    }
    if (name === "powerfarm_session_append_event") {
      const event = structuredClone(p.p_event) as Event;
      const existing = this.events.get(event.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(event)) throw new Error("event conflict");
      this.events.set(event.id, event);
      const row = this.sessions.get(sessionKey);
      if (!row) throw new Error("session missing");
      row.state = structuredClone(p.p_state);
      row.last_update_time = p.p_event_timestamp;
      return event;
    }
    if (name === "powerfarm_run_create") {
      const key = `${String(p.p_gadget_id)}:${String(p.p_idempotency_key)}`;
      const existing = this.runs.get(key);
      if (existing) return structuredClone(existing);
      const row = {
        id: `00000000-0000-4000-8000-${String(++this.runSequence).padStart(12, "0")}`,
        gadget_id: p.p_gadget_id, gadget_version: p.p_gadget_version,
        definition_hash: p.p_definition_hash, engine_ref: p.p_session_id,
        idempotency_key: p.p_idempotency_key, status: "created", result: null,
        error: null, checkpoint: { ordinal: 0, status: "created", state: {} },
      };
      this.runs.set(key, row);
      return structuredClone(row);
    }
    if (name === "powerfarm_run_get") {
      const row = [...this.runs.values()].find((candidate) => candidate.id === p.p_run_id);
      return row ? structuredClone(row) : null;
    }
    if (name === "powerfarm_run_transition") {
      const row = [...this.runs.values()].find((candidate) => candidate.id === p.p_run_id);
      if (!row) throw new Error("run missing");
      const expected = p.p_expected as string[];
      if (!expected.includes(String(row.status)) && row.status !== p.p_next) throw new Error("invalid transition");
      row.status = p.p_next;
      row.result = structuredClone(p.p_result);
      row.error = structuredClone(p.p_error);
      row.checkpoint = {
        ordinal: Number((row.checkpoint as Record<string, unknown>).ordinal) + 1,
        status: p.p_next,
        state: structuredClone(p.p_state),
        pending_input: structuredClone(p.p_pending_input),
        result: structuredClone(p.p_result),
      };
      return structuredClone(row);
    }
    if (name === "powerfarm_session_list") return { sessions: [], totalItems: 0 };
    if (name === "powerfarm_session_delete") return true;
    throw new Error(`Unexpected RPC ${name}`);
  }
}

function bindings() {
  return {
    models: {
      model: {
        async *generate(request: LlmRequest) {
          const hasResponse = request.contents.some((content) => content.parts?.some(
            (part) => "functionResponse" in part && part.functionResponse?.name === "adk_request_input",
          ));
          if (!hasResponse) {
            yield {
              content: { role: "model", parts: [{ functionCall: {
                id: "input-call-1", name: "adk_request_input", args: { message: "What is your name?" },
              } }] },
            };
          } else {
            yield { content: { role: "model", parts: [{ text: "resumed exactly once" }] }, turnComplete: true };
          }
        },
      },
    },
    codeExecutors: {},
    tools: {},
  };
}

describe("stateless invocation and resume", () => {
  it("persists waiting input, loses the runtime, and resumes in a new runtime", async () => {
    const database = new DurableFake();
    const firstRuntime = new PowerfarmInvocationRuntime(database, source, bindings());
    const waiting = await firstRuntime.invoke({
      userId: "caller", input: "start", idempotencyKey: "invoke-1",
    });
    expect(waiting).toMatchObject({ status: "waiting_input" });
    expect(waiting.pendingInput).toMatchObject({ callId: "input-call-1", message: "What is your name?" });

    const secondRuntime = new PowerfarmInvocationRuntime(database, source, bindings());
    const completed = await secondRuntime.resume({
      userId: "caller", runId: waiting.runId, input: "Ada",
    });
    expect(completed).toMatchObject({ status: "completed", result: { text: "resumed exactly once" } });
    expect(database.events.size).toBeGreaterThanOrEqual(4);
  });

  it("returns the same durable waiting run for a repeated invocation key", async () => {
    const database = new DurableFake();
    const runtime = new PowerfarmInvocationRuntime(database, source, bindings());
    const first = await runtime.invoke({ userId: "caller", input: "start", idempotencyKey: "same" });
    const repeated = await runtime.invoke({ userId: "caller", input: "start", idempotencyKey: "same" });
    expect(repeated.runId).toBe(first.runId);
    expect(repeated.status).toBe("waiting_input");
  });
});
