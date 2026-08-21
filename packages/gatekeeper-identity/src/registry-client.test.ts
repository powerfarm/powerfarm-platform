import { describe, expect, it, vi } from "vitest";
import { SupabaseRegistryClient } from "./registry-client.js";

describe("Supabase Registry delegated client", () => {
  it("uses publishable key plus delegated user bearer and returns RPC JSON", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    const client = new SupabaseRegistryClient(
      "https://project.supabase.co", "publishable", "user-jwt", fetcher,
    );

    await expect(client.rpc("powerfarm_identity_context", {})).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(
      "https://project.supabase.co/rest/v1/rpc/powerfarm_identity_context",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ apikey: "publishable", authorization: "Bearer user-jwt" }),
      }),
    );
  });

  it("preserves the Workers global fetch receiver on the default runtime path", async () => {
    const originalFetch = globalThis.fetch;
    const receiverSensitiveFetch = vi.fn(function(
      this: unknown,
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation: function called with incorrect `this` reference");
      }
      return Promise.resolve(Response.json({ ok: true }));
    });

    globalThis.fetch = receiverSensitiveFetch as typeof fetch;
    try {
      const client = new SupabaseRegistryClient(
        "https://project.supabase.co", "publishable", "user-jwt",
      );
      await expect(client.rpc("powerfarm_identity_context", {})).resolves.toEqual({ ok: true });
      expect(receiverSensitiveFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not reflect provider error bodies or admit arbitrary RPC names", async () => {
    const client = new SupabaseRegistryClient(
      "https://project.supabase.co", "publishable", "user-jwt",
      async () => new Response("credential detail", { status: 500 }),
    );
    await expect(client.rpc("powerfarm_identity_context", {})).rejects.not.toThrow("credential detail");
    await expect(client.rpc("not_powerfarm", {})).rejects.toThrow("RPC");
  });
});
