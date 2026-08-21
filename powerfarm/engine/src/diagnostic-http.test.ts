import { describe, expect, it } from "vitest";
import { createDiagnosticHttpHandler } from "./diagnostic-http.js";

describe("Engine public diagnostic surface", () => {
  it("keeps health visible but exposes no public invocation route", async () => {
    const handler = createDiagnosticHttpHandler();
    const health = await handler.fetch(new Request("https://engine/healthz"));
    expect(health.status).toBe(200);

    const invocation = await handler.fetch(new Request(
      "https://engine/v1/gadgets/hello-agentic/invocations",
      { method: "POST", body: "{}" },
    ));
    expect(invocation.status).toBe(404);
  });
});
