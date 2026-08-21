import {
  BaseCodeExecutor,
  CodeExecutionLanguage,
  type CodeExecutionInput,
  type CodeExecutionResult,
  type ExecuteCodeParams,
} from "../adk.js";

/** Existing isolated code-mode authority supplied by the Powerfarm host. */
export interface CodeExecutionCapability {
  execute(input: CodeExecutionInput): Promise<CodeExecutionResult>;
}

/**
 * ADK adapter only. The host binding must call the existing Overseer code-mode
 * seam; this class intentionally knows nothing about env.LOADER or credentials.
 */
export class PowerfarmCodeExecutor extends BaseCodeExecutor {
  override stateful = false;
  override errorRetryAttempts = 0;

  constructor(
    readonly capabilityId: string,
    private readonly capability: CodeExecutionCapability,
  ) {
    super();
  }

  override async executeCode({ codeExecutionInput }: ExecuteCodeParams): Promise<CodeExecutionResult> {
    const { language } = codeExecutionInput;
    if (
      language !== CodeExecutionLanguage.JAVASCRIPT
      && language !== CodeExecutionLanguage.TYPESCRIPT
    ) {
      throw new Error("Powerfarm v0.1 code execution accepts JavaScript or TypeScript only");
    }
    return await this.capability.execute(codeExecutionInput);
  }
}
