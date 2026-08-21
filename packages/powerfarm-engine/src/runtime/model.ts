import { BaseLlm, type LlmRequest, type LlmResponse } from "../adk.js";

export interface ModelGenerationOptions {
  stream: boolean;
  abortSignal?: AbortSignal;
}

/** A deliberately narrow model authority supplied by the Powerfarm host. */
export interface ModelCapability {
  generate(
    request: LlmRequest,
    options: ModelGenerationOptions,
  ): AsyncIterable<LlmResponse>;
}

/** ADK model boundary that contains a capability reference, never a secret. */
export class PowerfarmModel extends BaseLlm {
  constructor(
    readonly capabilityId: string,
    private readonly capability: ModelCapability,
  ) {
    super({ model: `powerfarm:${capabilityId}` });
  }

  override async *generateContentAsync(
    request: LlmRequest,
    stream = false,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<LlmResponse, void> {
    yield* this.capability.generate(request, { stream, abortSignal });
  }

  override async connect(): Promise<never> {
    throw new Error("Powerfarm model capabilities do not expose ADK live connections in v0.1");
  }
}
