import { describe, expect, it } from "vitest";
import { GadgetContractError, compileGadgetYaml, parseGadgetYaml } from "./gadget.js";

const valid = `
apiVersion: powerfarm.app/v1alpha1
kind: Gadget
metadata:
  id: hello-agentic
  version: 0.1.0
spec:
  agentic:
    runtime: adk-js
  agents:
    assistant:
      model:
        capability: model
      instruction: Help the user complete the task.
      capabilities: [model, input]
  flows:
    default:
      sequence:
        - agent: assistant
  capabilities:
    model:
      kind: model
      target: workers-ai
    input:
      kind: input
      target: user
`;

describe("Gadget v0.1 contract", () => {
  it("parses, normalizes, and compiles a valid agentic Gadget", async () => {
    const parsed = parseGadgetYaml(valid);
    const compiled = await compileGadgetYaml(valid);

    expect(parsed.metadata).toEqual({ id: "hello-agentic", version: "0.1.0" });
    expect(compiled.placement).toBe("cloudflare-adk-js");
    expect(compiled.flow.sequence).toEqual(["assistant"]);
    expect(compiled.definitionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same hash for equivalent map ordering", async () => {
    const reordered = valid.replace(
      "    model:\n      kind: model\n      target: workers-ai\n    input:\n      kind: input\n      target: user",
      "    input:\n      target: user\n      kind: input\n    model:\n      target: workers-ai\n      kind: model",
    );
    expect((await compileGadgetYaml(reordered)).definitionHash)
      .toBe((await compileGadgetYaml(valid)).definitionHash);
  });

  it.each([
    ["unknown field", valid.replace("kind: Gadget", "kind: Gadget\nextra: true")],
    ["missing capability", valid.replace("capabilities: [model, input]", "capabilities: [model, absent]")],
    ["missing flow agent", valid.replace("- agent: assistant", "- agent: absent")],
    ["secret-shaped field", valid.replace("target: workers-ai", "target: workers-ai\n      apiKey: raw-secret")],
  ])("rejects %s", (_name, source) => {
    expect(() => parseGadgetYaml(source)).toThrow(GadgetContractError);
  });

  it("rejects duplicate YAML keys instead of accepting last-one-wins", () => {
    expect(() => parseGadgetYaml(`${valid}\nkind: Gadget\n`)).toThrow(/unique/i);
  });
});
