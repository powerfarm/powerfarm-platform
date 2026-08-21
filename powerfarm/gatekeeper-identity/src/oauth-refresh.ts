type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RefreshOAuthTokensOptions {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  fetcher?: FetchFunction;
  now?: Date;
}

export interface RefreshedOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export async function refreshOAuthTokens(
  options: RefreshOAuthTokensOptions,
): Promise<RefreshedOAuthTokens> {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: options.refreshToken,
  });
  if (options.clientSecret !== undefined && options.clientSecret !== "") {
    headers.authorization = `Basic ${btoa(`${options.clientId}:${options.clientSecret}`)}`;
  } else {
    body.set("client_id", options.clientId);
  }

  const response = await (options.fetcher ?? fetch)(
    `${options.issuer.replace(/\/+$/, "")}/oauth/token`,
    { method: "POST", headers, body },
  );
  if (!response.ok) throw new Error("Powerfarm reauthentication required");
  const value: unknown = await response.json();
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Powerfarm OAuth refresh returned an invalid response");
  }
  const token = value as Record<string, unknown>;
  if (typeof token.access_token !== "string" || token.access_token === ""
    || typeof token.expires_in !== "number" || token.expires_in <= 0) {
    throw new Error("Powerfarm OAuth refresh returned an invalid response");
  }
  const now = options.now ?? new Date();
  return {
    accessToken: token.access_token,
    refreshToken: typeof token.refresh_token === "string" && token.refresh_token !== ""
      ? token.refresh_token : options.refreshToken,
    expiresAt: new Date(now.getTime() + token.expires_in * 1_000).toISOString(),
  };
}
