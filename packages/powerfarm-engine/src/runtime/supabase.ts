import { createClient } from "@supabase/supabase-js";
import type { PowerfarmDatabase } from "./session-service.js";

export interface SupabaseInvocationConfig {
  url: string;
  publishableKey: string;
  callerBearer: string;
}

interface SupabaseErrorLike { message: string }

export interface SupabaseRuntimeClient {
  auth: {
    getClaims(jwt: string): Promise<{
      data: unknown;
      error: SupabaseErrorLike | null;
    }>;
  };
  rpc(name: string, params: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: SupabaseErrorLike | null;
  }>;
}

export type SupabaseClientFactory = (config: SupabaseInvocationConfig) => SupabaseRuntimeClient;

const sdkFactory: SupabaseClientFactory = (config) => {
  const client = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${config.callerBearer}` } },
  });
  // The Registry does not yet generate Supabase client types. Keep the SDK's
  // broad generic response quarantined at this boundary; all callers validate
  // unknown RPC results before use.
  return client as unknown as SupabaseRuntimeClient;
};

export class PowerfarmAuthenticationError extends Error {
  constructor() {
    super("Powerfarm authentication failed");
    this.name = "PowerfarmAuthenticationError";
  }
}

export class PowerfarmDatabaseError extends Error {
  constructor(readonly operation: string, message: string) {
    super(`Powerfarm database operation ${operation} failed: ${message}`);
    this.name = "PowerfarmDatabaseError";
  }
}

export async function createPowerfarmDatabase(
  config: SupabaseInvocationConfig,
  factory: SupabaseClientFactory = sdkFactory,
): Promise<PowerfarmDatabase> {
  if (!config.url.startsWith("https://") || config.publishableKey === "" || config.callerBearer === "") {
    throw new PowerfarmAuthenticationError();
  }
  const client = factory(config);
  const claims = await client.auth.getClaims(config.callerBearer);
  if (claims.error !== null || claims.data === null) throw new PowerfarmAuthenticationError();

  return Object.freeze({
    async rpc(name: string, params: Record<string, unknown>): Promise<unknown> {
      const { data, error } = await client.rpc(name, params);
      if (error !== null) throw new PowerfarmDatabaseError(name, error.message);
      return data;
    },
  });
}
