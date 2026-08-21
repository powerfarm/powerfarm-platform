export function createDiagnosticHttpHandler(): {
  fetch(request: Request): Promise<Response>;
} {
  return Object.freeze({
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/healthz") {
        return Response.json(
          { ok: true, service: "pf.engine", compute: "disposable", invocation: "private-rpc" },
          { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
        );
      }
      return Response.json(
        { error: "not_found" },
        { status: 404, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
      );
    },
  });
}
