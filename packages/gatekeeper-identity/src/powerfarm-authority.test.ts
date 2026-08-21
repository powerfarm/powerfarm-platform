import { describe, expect, it, vi } from "vitest";
import { PowerfarmAuthorityBroker } from "./powerfarm-authority.js";

describe("Powerfarm capability authority", () => {
  it("resolves hello.run before issuing a snapshot grant and calling private Engine RPC", async () => {
    const calls: string[] = [];
    const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
      calls.push(name);
      if (name === "powerfarm_identity_context") return {
        principal_ref: "principal", workspaces: [{ workspace_ref: "workspace", role: "owner" }],
      };
      if (name === "powerfarm_resolve_execution") return {
        principal_ref: "principal", workspace_ref: "workspace", capability_ref: "hello.run",
        gadget_ref: "hello-agentic", gadget_revision: 7,
        gadget_revision_hash: "a".repeat(64), gadget_definition_hash: "b".repeat(64),
        operation: "run", allowed_capabilities: ["model", "input"], authority_version: 1,
      };
      if (name === "powerfarm_issue_run_grant") {
        expect(params).toMatchObject({
          p_workspace_ref: "workspace", p_capability_ref: "hello.run",
          p_gadget_ref: "hello-agentic", p_gadget_revision: 7,
          p_gadget_revision_hash: "a".repeat(64),
          p_gadget_definition_hash: "b".repeat(64), p_operation: "run",
          p_idempotency_key: "tool-call-1",
        });
        return { id: "grant" };
      }
      if (name === "powerfarm_execution_envelope") return {
        envelope_version: "powerfarm.execution/v0.1", run_grant_ref: "grant",
        idempotency_key: params.p_idempotency_key, input: params.p_input,
      };
      throw new Error(`unexpected ${name}`);
    });
    const invokeGadget = vi.fn(async () => ({ runId: "run", status: "waiting_input" }));
    const broker = new PowerfarmAuthorityBroker({ rpc }, { invokeGadget });

    const result = await broker.helloRun({ task: "hello" }, "tool-call-1", "private-user-jwt");

    expect(calls).toEqual([
      "powerfarm_identity_context", "powerfarm_resolve_execution",
      "powerfarm_issue_run_grant", "powerfarm_execution_envelope",
    ]);
    expect(invokeGadget).toHaveBeenCalledWith(expect.objectContaining({ run_grant_ref: "grant" }),
      "private-user-jwt");
    expect(result).toEqual({ runId: "run", status: "waiting_input" });
    expect(JSON.stringify(invokeGadget.mock.calls[0]?.[0])).not.toContain("private-user-jwt");
  });

  it("denies ambiguous workspace authority before resolution", async () => {
    const rpc = vi.fn(async () => ({
      principal_ref: "principal",
      workspaces: [{ workspace_ref: "one" }, { workspace_ref: "two" }],
    }));
    const invokeGadget = vi.fn();
    const broker = new PowerfarmAuthorityBroker({ rpc }, { invokeGadget });

    await expect(broker.helloRun({}, "key", "jwt")).rejects.toThrow("workspace");
    expect(invokeGadget).not.toHaveBeenCalled();
  });

  it("resumes through Registry revalidation and the private resume entrypoint", async () => {
    const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
      expect(name).toBe("powerfarm_resume_envelope");
      expect(params).toEqual({
        p_run_id: "run-1", p_input: "Ada", p_idempotency_key: "resume-1",
      });
      return { operation: "resume", run_ref: "run-1" };
    });
    const resumeRun = vi.fn(async () => ({ runId: "run-1", status: "completed" }));
    const broker = new PowerfarmAuthorityBroker({ rpc }, {
      invokeGadget: vi.fn(), resumeRun,
    });

    await broker.resumeHello("run-1", "Ada", "resume-1", "private-user-jwt");
    expect(resumeRun).toHaveBeenCalledWith(
      { operation: "resume", run_ref: "run-1" }, "private-user-jwt",
    );
  });

  it("publishes the same authored draft only after Engine validates its exact definition", async () => {
    const source = "apiVersion: powerfarm.app/v1alpha1";
    const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
      if (name === "powerfarm_gadget_get_draft") return {
        gadget_id: "hello-agentic", draft_revision: 4,
        authored_state: { files: { "gadget.yaml": source } },
      };
      if (name === "powerfarm_gadget_publish") {
        expect(params).toEqual({
          p_gadget_id: "hello-agentic", p_base_revision: 4,
          p_definition_hash: "c".repeat(64),
        });
        return { revision: 2, definition_hash: "c".repeat(64) };
      }
      throw new Error(`unexpected ${name}`);
    });
    const validateGadget = vi.fn(async () => ({
      gadgetId: "hello-agentic", gadgetVersion: "0.1.1", definitionHash: "c".repeat(64),
    }));
    const broker = new PowerfarmAuthorityBroker({ rpc }, {
      invokeGadget: vi.fn(), validateGadget,
    });

    const published = await broker.publishHello(4);
    expect(validateGadget).toHaveBeenCalledWith(source);
    expect(published).toEqual({ revision: 2, definition_hash: "c".repeat(64) });
  });

  it("reads and patches only the fixed hello-agentic lineage with optimistic concurrency", async () => {
    const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => ({ name, params }));
    const broker = new PowerfarmAuthorityBroker({ rpc }, { invokeGadget: vi.fn() });

    await broker.getHelloDraft();
    await broker.applyHelloPatch(3, { files: { "gadget.yaml": "yaml" } }, "edit-1");

    expect(rpc.mock.calls).toEqual([
      ["powerfarm_gadget_get_draft", { p_gadget_id: "hello-agentic" }],
      ["powerfarm_gadget_apply_patch", {
        p_gadget_id: "hello-agentic",
        p_base_revision: 3,
        p_patch: { files: { "gadget.yaml": "yaml" } },
        p_client_operation_id: "edit-1",
      }],
    ]);
  });
});
