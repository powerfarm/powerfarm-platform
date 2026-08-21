import { describe, expect, it } from "vitest";
import type { LlmRequest, LlmResponse } from "../adk.js";
import { PowerfarmModel, type ModelCapability } from "./model.js";

describe("Powerfarm model capability", () => {
  it("delegates through the named capability without an ambient credential", async () => {
    const seen: LlmRequest[] = [];
    const capability: ModelCapability = {
      async *generate(request) {
        seen.push(request);
        yield { content: { role: "model", parts: [{ text: "bound" }] } };
      },
    };
    const model = new PowerfarmModel("model", capability);
    const request = { contents: [{ role: "user", parts: [{ text: "hello" }] }] } as LlmRequest;
    const responses: LlmResponse[] = [];
    for await (const response of model.generateContentAsync(request)) responses.push(response);

    expect(seen).toEqual([request]);
    expect(responses[0]?.content?.parts?.[0]).toEqual({ text: "bound" });
    expect(Object.keys(model)).not.toContain("env");
    expect(JSON.stringify(model)).not.toMatch(/token|secret|credential/i);
  });
});
