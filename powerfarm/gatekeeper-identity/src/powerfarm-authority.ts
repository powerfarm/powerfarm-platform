export interface RegistryAuthorityClient {
  rpc(name: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface WorkspaceEngineBinding {
  validateGadget?(source: string): Promise<unknown>;
  invokeGadget(envelope: unknown, delegatedBearer: string): Promise<unknown>;
  resumeRun?(envelope: unknown, delegatedBearer: string): Promise<unknown>;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid Registry ${label}`);
  }
  return value as JsonObject;
}

function field<T extends "string" | "number">(
  value: JsonObject,
  key: string,
  type: T,
): T extends "string" ? string : number {
  const result = value[key];
  if (typeof result !== type) throw new Error(`Invalid Registry field ${key}`);
  return result as T extends "string" ? string : number;
}

/**
 * Converts the specific Workspace capability into exact Registry authority.
 * The caller cannot provide a workspace, Gadget, revision, source, or grant.
 */
export class PowerfarmAuthorityBroker {
  constructor(
    private readonly registry: RegistryAuthorityClient,
    private readonly engine: WorkspaceEngineBinding,
  ) {}

  async getHelloDraft(): Promise<unknown> {
    return this.registry.rpc("powerfarm_gadget_get_draft", {
      p_gadget_id: "hello-agentic",
    });
  }

  async applyHelloPatch(
    baseRevision: number,
    patch: unknown,
    clientOperationId: string,
  ): Promise<unknown> {
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
      throw new Error("A valid draft revision is required");
    }
    if (clientOperationId.trim() === "" || clientOperationId.length > 200) {
      throw new Error("A valid client operation ID is required");
    }
    return this.registry.rpc("powerfarm_gadget_apply_patch", {
      p_gadget_id: "hello-agentic",
      p_base_revision: baseRevision,
      p_patch: patch,
      p_client_operation_id: clientOperationId,
    });
  }

  async publishHello(baseRevision: number): Promise<unknown> {
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
      throw new Error("A valid draft revision is required");
    }
    if (this.engine.validateGadget === undefined) {
      throw new Error("Powerfarm Gadget validation capability unavailable");
    }
    const draft = object(await this.getHelloDraft(), "Gadget draft");
    if (field(draft, "gadget_id", "string") !== "hello-agentic"
      || field(draft, "draft_revision", "number") !== baseRevision) {
      throw new Error("Gadget draft changed before publication");
    }
    const authoredState = object(draft.authored_state, "authored state");
    const files = object(authoredState.files, "authored files");
    const source = files["gadget.yaml"];
    if (typeof source !== "string" || source.length === 0) {
      throw new Error("Gadget draft has no gadget.yaml source");
    }
    const validated = object(await this.engine.validateGadget(source), "validated Gadget");
    if (field(validated, "gadgetId", "string") !== "hello-agentic") {
      throw new Error("Validated Gadget identity does not match its lineage");
    }
    return this.registry.rpc("powerfarm_gadget_publish", {
      p_gadget_id: "hello-agentic",
      p_base_revision: baseRevision,
      p_definition_hash: field(validated, "definitionHash", "string"),
    });
  }

  async helloRun(input: unknown, idempotencyKey: string, delegatedBearer: string): Promise<unknown> {
    if (idempotencyKey.trim() === "" || idempotencyKey.length > 200) {
      throw new Error("A valid idempotency key is required");
    }
    if (delegatedBearer.length === 0 || delegatedBearer.length > 16_384) {
      throw new Error("Delegated authentication required");
    }

    const identity = object(
      await this.registry.rpc("powerfarm_identity_context", {}),
      "IdentityContext",
    );
    if (!Array.isArray(identity.workspaces) || identity.workspaces.length !== 1) {
      throw new Error("Exactly one authorized Powerfarm workspace is required in v0.1");
    }
    const workspace = object(identity.workspaces[0], "workspace");
    const workspaceRef = field(workspace, "workspace_ref", "string");
    const resolved = object(await this.registry.rpc("powerfarm_resolve_execution", {
      p_workspace_ref: workspaceRef,
      p_capability_ref: "hello.run",
    }), "execution resolution");

    const grant = object(await this.registry.rpc("powerfarm_issue_run_grant", {
      p_workspace_ref: workspaceRef,
      p_capability_ref: "hello.run",
      p_gadget_ref: field(resolved, "gadget_ref", "string"),
      p_gadget_revision: field(resolved, "gadget_revision", "number"),
      p_gadget_revision_hash: field(resolved, "gadget_revision_hash", "string"),
      p_gadget_definition_hash: field(resolved, "gadget_definition_hash", "string"),
      p_operation: field(resolved, "operation", "string"),
      p_idempotency_key: idempotencyKey,
      p_ttl_seconds: 86_400,
    }), "RunGrant");

    const envelope = await this.registry.rpc("powerfarm_execution_envelope", {
      p_run_grant_ref: field(grant, "id", "string"),
      p_input: input,
      p_idempotency_key: idempotencyKey,
    });
    return this.engine.invokeGadget(envelope, delegatedBearer);
  }

  async resumeHello(
    runId: string,
    input: unknown,
    idempotencyKey: string,
    delegatedBearer: string,
  ): Promise<unknown> {
    if (runId.trim() === "" || idempotencyKey.trim() === "" || idempotencyKey.length > 200) {
      throw new Error("A valid run and idempotency key are required");
    }
    if (delegatedBearer.length === 0 || delegatedBearer.length > 16_384) {
      throw new Error("Delegated authentication required");
    }
    if (this.engine.resumeRun === undefined) throw new Error("Powerfarm resume capability unavailable");
    const envelope = await this.registry.rpc("powerfarm_resume_envelope", {
      p_run_id: runId,
      p_input: input,
      p_idempotency_key: idempotencyKey,
    });
    return this.engine.resumeRun(envelope, delegatedBearer);
  }
}
