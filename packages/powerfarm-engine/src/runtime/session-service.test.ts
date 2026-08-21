import { describe, expect, it } from "vitest";
import type { Event } from "../adk.js";
import {
  SupabaseSessionService,
  type PowerfarmDatabase,
} from "./session-service.js";

class FakeDatabase implements PowerfarmDatabase {
  readonly sessions = new Map<string, Record<string, unknown>>();
  readonly events = new Map<string, Event>();

  async rpc(name: string, params: Record<string, unknown>): Promise<unknown> {
    const key = `${String(params.p_app_name)}:${String(params.p_session_id)}`;
    if (name === "powerfarm_session_create") {
      const row = this.sessions.get(key) ?? {
        id: params.p_session_id,
        app_name: params.p_app_name,
        user_id: "identity-1",
        state: structuredClone(params.p_state),
        last_update_time: params.p_last_update_time,
        events: [],
      };
      this.sessions.set(key, row);
      return structuredClone(row);
    }
    if (name === "powerfarm_session_get") {
      const row = this.sessions.get(key);
      if (!row) return null;
      return { ...structuredClone(row), events: [...this.events.values()] };
    }
    if (name === "powerfarm_session_list") {
      return {
        sessions: [...this.sessions.values()].map((row) => ({ ...structuredClone(row), events: [] })),
        totalItems: this.sessions.size,
      };
    }
    if (name === "powerfarm_session_delete") {
      this.sessions.delete(key);
      return true;
    }
    if (name === "powerfarm_session_append_event") {
      const event = structuredClone(params.p_event) as Event;
      const existing = this.events.get(event.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(event)) throw new Error("event conflict");
      this.events.set(event.id, event);
      const row = this.sessions.get(key);
      if (!row) throw new Error("session missing");
      row.state = structuredClone(params.p_state);
      row.last_update_time = params.p_event_timestamp;
      return event;
    }
    throw new Error(`Unexpected RPC ${name}`);
  }
}

const config = {
  gadgetId: "hello-agentic",
  gadgetVersion: "0.1.0",
  definitionHash: "a".repeat(64),
};

function stateEvent(): Event {
  return {
    id: "event-1",
    invocationId: "invocation-1",
    author: "assistant",
    timestamp: 42,
    actions: {
      stateDelta: { answer: 42 },
      artifactDelta: {},
      requestedAuthConfigs: {},
      requestedToolConfirmations: {},
    },
    content: { role: "model", parts: [{ text: "done" }] },
  };
}

describe("Supabase ADK session service", () => {
  it("persists state/events and reloads them from a fresh service instance", async () => {
    const database = new FakeDatabase();
    const first = new SupabaseSessionService(database, config);
    const session = await first.createSession({
      appName: "hello-agentic",
      userId: "caller",
      sessionId: "session-1",
      state: { count: 1 },
    });
    await first.appendEvent({ session, event: stateEvent() });

    const second = new SupabaseSessionService(database, config);
    const loaded = await second.getSession({
      appName: "hello-agentic",
      userId: "caller",
      sessionId: "session-1",
    });
    expect(loaded?.state).toEqual({ count: 1, answer: 42 });
    expect(loaded?.events.map(({ id }) => id)).toEqual(["event-1"]);
  });

  it("deduplicates an identical event and rejects changed content under the same id", async () => {
    const database = new FakeDatabase();
    const service = new SupabaseSessionService(database, config);
    const session = await service.createSession({ appName: "app", userId: "caller", sessionId: "s" });
    await service.appendEvent({ session, event: stateEvent() });
    await service.appendEvent({ session, event: stateEvent() });
    expect(database.events.size).toBe(1);

    const changed = stateEvent();
    changed.author = "other";
    await expect(service.appendEvent({ session, event: changed })).rejects.toThrow(/conflict/i);
  });

  it("lists and deletes sessions through the durable boundary", async () => {
    const database = new FakeDatabase();
    const service = new SupabaseSessionService(database, config);
    await service.createSession({ appName: "app", userId: "caller", sessionId: "s" });
    expect((await service.listSessions({ appName: "app", userId: "caller" })).totalItems).toBe(1);
    await service.deleteSession({ appName: "app", userId: "caller", sessionId: "s" });
    expect(await service.getSession({ appName: "app", userId: "caller", sessionId: "s" })).toBeUndefined();
  });
});
