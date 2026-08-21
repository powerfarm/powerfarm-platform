import { describe, expect, it } from "vitest";
import type { LlmRequest } from "../adk.js";
import { compileGadgetYaml } from "../contracts/gadget.js";
import { MissingCapabilityError, compileAdkGadget } from "./compile-adk.js";

const source = `
apiVersion: powerfarm.app/v1alpha1
kind: Gadget
metadata: { id: hello-agentic, version: 0.1.0 }
spec:
  agentic: { runtime: adk-js }
  agents:
    assistant:
      model: { capability: model }
      instruction: Help the user.
      capabilities: [model, input]
  flows:
    default:
      sequence: [{ agent: assistant }]
  capabilities:
    model: { kind: model, target: workers-ai }
    input: { kind: input, target: user }
`;

describe("ADK compilation", () => {
  it("denies a missing capability before a model can be called", async () => {
    const plan = await compileGadgetYaml(source);
    expect(() => compileAdkGadget(plan, { models: {}, codeExecutors: {}, tools: {} }))
      .toThrow(MissingCapabilityError);
  });

  it("constructs the Gadget-owned workflow and attaches explicit input", async () => {
    const plan = await compileGadgetYaml(source);
    const runtime = compileAdkGadget(plan, {
      models: {
        model: {
          async *generate(_request: LlmRequest) {
            yield { content: { role: "model", parts: [{ text: "ok" }] } };
          },
        },
      },
      codeExecutors: {},
      tools: {},
    });

    expect(runtime.rootAgent.name).toBe("defaultFlow");
    expect(runtime.agents.assistant.parentAgent).toBe(runtime.rootAgent);
    const tools = await runtime.agents.assistant.canonicalTools();
    expect(tools.map((tool) => tool.name)).toContain("adk_request_input");
  });
});
