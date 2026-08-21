import { describe, expect, it, vi } from "vitest";
import type { LlmRequest } from "../adk.js";
import { WorkersAiModelCapability } from "./workers-ai.js";

function request(): LlmRequest {
  return {
    contents: [{ role: "user", parts: [{ text: "Ask for my name" }] }],
    config: { tools: [{ functionDeclarations: [{
      name: "adk_request_input",
      description: "Ask the user",
      parametersJsonSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
    }] }] },
    liveConnectConfig: {},
    toolsDict: {},
  };
}

describe("Workers AI model capability", () => {
  it("translates ADK messages/tools and returns an ADK function call", async () => {
    const run = vi.fn(async () => ({
      response: "",
      tool_calls: [{ name: "adk_request_input", arguments: { message: "Your name?" } }],
    }));
    const capability = new WorkersAiModelCapability({ run }, "@cf/test/model");
    const responses = [];
    for await (const response of capability.generate(request(), { stream: false })) responses.push(response);

    expect(run).toHaveBeenCalledWith("@cf/test/model", expect.objectContaining({
      messages: [{ role: "user", content: "Ask for my name" }],
      tools: [expect.objectContaining({ name: "adk_request_input" })],
      stream: false,
    }));
    expect(responses[0]?.content?.parts?.[0]).toMatchObject({
      functionCall: { name: "adk_request_input", args: { message: "Your name?" } },
    });
  });

  it("returns text without exposing binding state in the ADK response", async () => {
    const capability = new WorkersAiModelCapability({
      run: async () => ({ response: "hello", usage: { total_tokens: 3 } }),
    }, "@cf/test/model");
    const responses = [];
    for await (const response of capability.generate(request(), { stream: false })) responses.push(response);
    expect(responses[0]?.content?.parts).toEqual([{ text: "hello" }]);
    expect(JSON.stringify(responses)).not.toMatch(/token|credential|secret/i);
  });
});
