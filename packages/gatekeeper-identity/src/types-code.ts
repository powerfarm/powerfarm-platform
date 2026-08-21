const TYPES_CODE = `/** Result of the installed hello.run Powerfarm capability. */
export type PowerfarmJson = null | boolean | number | string | PowerfarmJson[] |
  { [key: string]: PowerfarmJson };

export interface HelloRunResult {
  runId: string;
  sessionId: string;
  status: "waiting_input" | "completed";
  pendingInput?: { message: string; responseSchema?: unknown };
  result?: { text: string };
  provenance: {
    gadgetId: string;
    gadgetVersion: string;
    definitionHash: string;
    gadgetRevision?: number;
    gadgetRevisionHash?: string;
    capabilityRef?: string;
    authorityVersion?: number;
    runtime: string;
  };
}

/** The mutable authoring state shared by the Platform UI and Workspace LLM. */
export interface HelloDraft {
  gadget_id: "hello-agentic";
  draft_revision: number;
  authored_state: { files: { "gadget.yaml": string } };
}

/** Specific Powerfarm capabilities available to the signed-in Workspace. */
export interface PowerfarmSession {
  /** Reads the current hello-agentic draft from the canonical Registry. */
  getHelloDraft(): Promise<HelloDraft>;

  /** Stages an optimistic authored-state merge patch for explicit platform approval. */
  applyHelloPatch(baseRevision: number, patch: { [key: string]: PowerfarmJson }, clientOperationId: string): Promise<void>;

  /** Stages publication of the exact current draft as an immutable revision. */
  publishHello(baseRevision: number): Promise<void>;

  /** Runs the installed hello.run capability. Reuse the key when retrying the same request. */
  helloRun(input: unknown, idempotencyKey: string): Promise<HelloRunResult>;

  /** Continues the same waiting hello.run with the requested input. */
  resumeHello(runId: string, input: unknown, idempotencyKey: string): Promise<HelloRunResult>;
}
`;

export default TYPES_CODE;
