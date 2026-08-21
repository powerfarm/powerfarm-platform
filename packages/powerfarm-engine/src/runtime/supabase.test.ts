import { describe, expect, it, vi } from "vitest";
import { createPowerfarmDatabase, type SupabaseRuntimeClient } from "./supabase.js";

describe("Supabase invocation database", () => {
  it("validates the caller JWT and maps RPC errors without exposing the bearer", async () => {
    const getClaims = vi.fn(async () => ({ data: { claims: { sub: "user" } }, error: null }));
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const client: SupabaseRuntimeClient = { auth: { getClaims }, rpc };
    const factory = vi.fn(() => client);
    const database = await createPowerfarmDatabase({
      url: "https://example.supabase.co",
      publishableKey: "public-key",
      callerBearer: "caller-jwt",
    }, factory);

    await expect(database.rpc("powerfarm_session_get", { p_session_id: "s" }))
      .resolves.toEqual({ ok: true });
    expect(getClaims).toHaveBeenCalledWith("caller-jwt");
    expect(JSON.stringify(database)).not.toContain("caller-jwt");
  });

  it("rejects an invalid caller before any database RPC", async () => {
    const rpc = vi.fn();
    const client: SupabaseRuntimeClient = {
      auth: { getClaims: async () => ({ data: null, error: { message: "bad JWT" } }) },
      rpc,
    };
    await expect(createPowerfarmDatabase({
      url: "https://example.supabase.co",
      publishableKey: "public-key",
      callerBearer: "bad",
    }, () => client)).rejects.toThrow(/authentication failed/i);
    expect(rpc).not.toHaveBeenCalled();
  });
});
