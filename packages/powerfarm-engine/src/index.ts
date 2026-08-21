import { WorkerEntrypoint } from "cloudflare:workers";
import { createDiagnosticHttpHandler } from "./diagnostic-http.js";
import type { EngineEnv } from "./http.js";
import { createWorkspaceRuntimeService } from "./workspace-runtime.js";

const diagnostic = createDiagnosticHttpHandler();
const workspaceRuntime = createWorkspaceRuntimeService();

/** The only Powerfarm Workspace execution surface exposed to a service binding. */
export class WorkspaceRuntime extends WorkerEntrypoint<EngineEnv> {
  async validateGadget(source: string) {
    return workspaceRuntime.validateGadget(source);
  }

  async invokeGadget(envelope: unknown, delegatedBearer: string) {
    return workspaceRuntime.invokeGadget(envelope, delegatedBearer, this.env);
  }

  async resumeRun(envelope: unknown, delegatedBearer: string) {
    return workspaceRuntime.resumeRun(envelope, delegatedBearer, this.env);
  }
}

export default {
  fetch(request: Request): Promise<Response> {
    return diagnostic.fetch(request);
  },
};
