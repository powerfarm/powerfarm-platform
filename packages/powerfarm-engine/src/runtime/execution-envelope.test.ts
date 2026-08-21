import { describe, expect, it } from "vitest";
import { parseExecutionEnvelope, verifyExecutionEnvelope } from "./execution-envelope.js";
import { compileGadgetYaml } from "../contracts/gadget.js";

const source = `apiVersion: powerfarm.app/v1alpha1
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
      instruction: Help the user.
      capabilities: [model, input]
  flows:
    default:
      sequence:
        - agent: assistant
  capabilities:
    model: { kind: model, target: workers-ai }
    input: { kind: input, target: user }
`;

async function envelope() {
  const gadget = await compileGadgetYaml(source);
  return {
    envelope_version: "powerfarm.execution/v0.1",
    principal_ref: "00000000-0000-4000-8000-000000000010",
    workspace_ref: "00000000-0000-4000-8000-000000000001",
    capability_ref: "hello.run",
    gadget_ref: "hello-agentic",
    gadget_revision: 7,
    gadget_revision_hash: "a".repeat(64),
    gadget_definition_hash: gadget.definitionHash,
    gadget_version: "0.1.0",
    operation: "run",
    input: { task: "hello" },
    gadget_source: source,
    run_grant_ref: "00000000-0000-4000-8000-000000000020",
    allowed_capabilities: ["model", "input"],
    idempotency_key: "workspace-tool-call-1",
    authority_version: 1,
    issued_at: "2026-08-20T19:00:00.000Z",
    expires_at: "2026-08-21T19:00:00.000Z",
  };
}

describe("ExecutionEnvelope", () => {
  it("accepts and verifies one exact Registry-resolved Gadget snapshot", async () => {
    const parsed = parseExecutionEnvelope(await envelope(), new Date("2026-08-20T20:00:00.000Z"));
    const verified = await verifyExecutionEnvelope(parsed);

    expect(verified.gadget.id).toBe("hello-agentic");
    expect(verified.gadget.definitionHash).toBe(parsed.gadgetDefinitionHash);
    expect(verified.envelope.gadgetRevision).toBe(7);
  });

  it("rejects expiry, source substitution, and authority missing a required capability", async () => {
    const expired = await envelope();
    expect(() => parseExecutionEnvelope(expired, new Date("2026-08-22T00:00:00.000Z")))
      .toThrow("expired");

    const substituted = parseExecutionEnvelope({ ...(await envelope()), gadget_source: source.replace(
      "Help the user.", "Do something else.",
    ) }, new Date("2026-08-20T20:00:00.000Z"));
    await expect(verifyExecutionEnvelope(substituted)).rejects.toThrow("definition hash");

    const underGranted = parseExecutionEnvelope({
      ...(await envelope()), allowed_capabilities: ["model"],
    }, new Date("2026-08-20T20:00:00.000Z"));
    await expect(verifyExecutionEnvelope(underGranted)).rejects.toThrow("input");
  });

  it("does not admit OAuth or provider credentials into the envelope", async () => {
    const base = await envelope();
    expect(() => parseExecutionEnvelope({
      ...base, access_token: "secret",
    }, new Date("2026-08-20T20:00:00.000Z"))).toThrow("unknown field");
  });

  it("accepts resume only when it names the exact durable run", async () => {
    const base = await envelope();
    const resume = parseExecutionEnvelope({
      ...base,
      operation: "resume",
      run_ref: "00000000-0000-4000-8000-000000000030",
      idempotency_key: "resume-tool-call-1",
    }, new Date("2026-08-20T20:00:00.000Z"));
    expect(resume.operation).toBe("resume");
    expect(resume.runRef).toBe("00000000-0000-4000-8000-000000000030");

    expect(() => parseExecutionEnvelope({ ...base, operation: "resume" },
      new Date("2026-08-20T20:00:00.000Z"))).toThrow("run_ref");
  });
});
