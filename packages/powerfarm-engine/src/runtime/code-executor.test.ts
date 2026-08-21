import { describe, expect, it, vi } from "vitest";
import { CodeExecutionLanguage, type CodeExecutionInput } from "../adk.js";
import { PowerfarmCodeExecutor, type CodeExecutionCapability } from "./code-executor.js";

function input(language: CodeExecutionLanguage): CodeExecutionInput {
  return { code: "console.log(2 + 2)", language, inputFiles: [] };
}

describe("Powerfarm ADK code executor", () => {
  it("delegates JavaScript to an injected existing-code-mode capability", async () => {
    const execute = vi.fn(async () => ({ stdout: "4\n", stderr: "", outputFiles: [] }));
    const capability: CodeExecutionCapability = { execute };
    const executor = new PowerfarmCodeExecutor("execution", capability);

    await expect(executor.executeCode({
      invocationContext: {} as never,
      codeExecutionInput: input(CodeExecutionLanguage.JAVASCRIPT),
    })).resolves.toMatchObject({ stdout: "4\n" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each([CodeExecutionLanguage.PYTHON, CodeExecutionLanguage.SHELL])(
    "rejects unsupported shared-host language %s before delegation",
    async (language) => {
      const execute = vi.fn<CodeExecutionCapability["execute"]>();
      const executor = new PowerfarmCodeExecutor("execution", { execute });
      await expect(executor.executeCode({
        invocationContext: {} as never,
        codeExecutionInput: input(language),
      })).rejects.toThrow(/javascript or typescript/i);
      expect(execute).not.toHaveBeenCalled();
    },
  );
});
