import { createHash, randomUUID } from "node:crypto";
import {
  BaseSessionService,
  type AppendEventRequest,
  type CreateSessionRequest,
  type DeleteSessionRequest,
  type Event,
  type GetSessionRequest,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type Session,
} from "../adk.js";

export interface PowerfarmDatabase {
  rpc(name: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface DurableSessionDefinition {
  gadgetId: string;
  gadgetVersion: string;
  definitionHash: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Invalid database session field ${key}`);
  return value;
}

function requiredNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid database session field ${key}`);
  }
  return value;
}

function asSession(value: unknown): Session {
  if (!isRecord(value)) throw new Error("Invalid database session response");
  const state = value.state === undefined ? {} : value.state;
  const events = value.events === undefined ? [] : value.events;
  if (!isRecord(state) || !Array.isArray(events)) throw new Error("Invalid durable ADK session data");
  return {
    id: requiredString(value, "id"),
    appName: requiredString(value, "app_name"),
    userId: requiredString(value, "user_id"),
    state: structuredClone(state),
    events: structuredClone(events) as Event[],
    lastUpdateTime: requiredNumber(value, "last_update_time"),
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function eventHash(event: Event): string {
  return createHash("sha256").update(JSON.stringify(stableValue(event))).digest("hex");
}

export class SupabaseSessionService extends BaseSessionService {
  constructor(
    private readonly database: PowerfarmDatabase,
    private readonly definition: DurableSessionDefinition,
  ) {
    super();
  }

  override async createSession(request: CreateSessionRequest): Promise<Session> {
    const id = request.sessionId ?? randomUUID();
    const response = await this.database.rpc("powerfarm_session_create", {
      p_app_name: request.appName,
      p_session_id: id,
      p_gadget_id: this.definition.gadgetId,
      p_gadget_version: this.definition.gadgetVersion,
      p_definition_hash: this.definition.definitionHash,
      p_state: request.state ?? {},
      p_last_update_time: Date.now() / 1000,
    });
    return asSession(response);
  }

  override async getSession(request: GetSessionRequest): Promise<Session | undefined> {
    const response = await this.database.rpc("powerfarm_session_get", {
      p_app_name: request.appName,
      p_session_id: request.sessionId,
      p_num_recent_events: request.config?.numRecentEvents ?? null,
      p_after_timestamp: request.config?.afterTimestamp ?? null,
    });
    return response === null ? undefined : asSession(response);
  }

  override async listSessions(request: ListSessionsRequest): Promise<ListSessionsResponse> {
    const offset = request.page !== undefined && request.limit !== undefined
      ? (request.page - 1) * request.limit
      : (request.offset ?? 0);
    const response = await this.database.rpc("powerfarm_session_list", {
      p_app_name: request.appName,
      p_limit: request.limit ?? null,
      p_offset: offset,
      p_order: request.order ?? null,
    });
    if (!isRecord(response) || !Array.isArray(response.sessions)
      || typeof response.totalItems !== "number") {
      throw new Error("Invalid database session-list response");
    }
    const totalItems = response.totalItems;
    const limit = request.limit ?? totalItems;
    return {
      sessions: response.sessions.map(asSession),
      page: request.page ?? (limit > 0 ? Math.floor(offset / limit) + 1 : 1),
      limit,
      totalItems,
      totalPages: limit > 0 ? Math.ceil(totalItems / limit) : 0,
    };
  }

  override async deleteSession(request: DeleteSessionRequest): Promise<void> {
    await this.database.rpc("powerfarm_session_delete", {
      p_app_name: request.appName,
      p_session_id: request.sessionId,
    });
  }

  override async appendEvent(request: AppendEventRequest): Promise<Event> {
    const event = await super.appendEvent(request);
    if (event.partial) return event;
    await this.database.rpc("powerfarm_session_append_event", {
      p_app_name: request.session.appName,
      p_session_id: request.session.id,
      p_event_id: event.id,
      p_event_hash: eventHash(event),
      p_event: event,
      p_event_timestamp: event.timestamp,
      p_state: request.session.state,
    });
    request.session.lastUpdateTime = event.timestamp;
    return event;
  }
}
