import { describe, expect, it, vi } from "vitest";
import { refreshOAuthTokens } from "./oauth-refresh.js";

describe("Powerfarm OAuth token refresh", () => {
  it("uses refresh_token grant, client basic auth, and preserves rotation", async () => {
    const fetcher = vi.fn(async () => Response.json({
      access_token: "new-access", refresh_token: "rotated-refresh", expires_in: 3600,
    }));
    const refreshed = await refreshOAuthTokens({
      issuer: "https://project.supabase.co/auth/v1",
      clientId: "client", clientSecret: "secret", refreshToken: "old-refresh",
      fetcher, now: new Date("2026-08-20T20:00:00.000Z"),
    });

    expect(refreshed).toEqual({
      accessToken: "new-access", refreshToken: "rotated-refresh",
      expiresAt: "2026-08-20T21:00:00.000Z",
    });
    const request = fetcher.mock.calls[0];
    expect(request?.[0]).toBe("https://project.supabase.co/auth/v1/oauth/token");
    expect(String((request?.[1]?.body as URLSearchParams).get("grant_type"))).toBe("refresh_token");
    expect((request?.[1]?.headers as Record<string, string>).authorization).toMatch(/^Basic /);
  });

  it("returns a sanitized reauthentication error", async () => {
    await expect(refreshOAuthTokens({
      issuer: "https://project.supabase.co/auth/v1", clientId: "client",
      refreshToken: "revoked", fetcher: async () => new Response("provider secret", { status: 401 }),
    })).rejects.not.toThrow("provider secret");
  });
});
