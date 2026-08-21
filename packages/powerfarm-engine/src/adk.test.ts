import { describe, expect, it } from "vitest";
import {
  BaseCodeExecutor,
  BaseLlm,
  InMemorySessionService,
  LlmAgent,
  Runner,
  SequentialAgent,
  isFinalResponse,
  type CodeExecutionResult,
  type ExecuteCodeParams,
  type LlmRequest,
  type LlmResponse,
} from "./adk.js";

class TestModel extends BaseLlm {
  constructor() {
    super({ model: "powerfarm-test" });
  }

  async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse, void> {
    const input = request.contents.at(-1)?.parts?.find((part) => "text" in part)?.text ?? "";
    yield { content: { role: "model", parts: [{ text: `capability:${input}` }] }, turnComplete: true };
  }

  async connect(): Promise<never> {
    throw new Error("not used");
  }
}

class TestCodeExecutor extends BaseCodeExecutor {
  async executeCode(_params: ExecuteCodeParams): Promise<CodeExecutionResult> {
    return { stdout: "ok", stderr: "", outputFiles: [] };
  }
}

describe("pinned ADK surface", () => {
  it("constructs an LLM agent, workflow, runner, session service, and code executor", async () => {
    const sessionService = new InMemorySessionService();
    await sessionService.createSession({ appName: "test", userId: "user", sessionId: "session" });
    const agent = new LlmAgent({
      name: "assistant",
      model: new TestModel(),
      instruction: "Use the injected model.",
      codeExecutor: new TestCodeExecutor(),
    });
    const runner = new Runner({
      appName: "test",
      agent: new SequentialAgent({ name: "defaultFlow", subAgents: [agent] }),
      sessionService,
    });

    let final = "";
    for await (const event of runner.runAsync({
      userId: "user",
      sessionId: "session",
      newMessage: { role: "user", parts: [{ text: "hello" }] },
    })) {
      if (isFinalResponse(event)) {
        final = event.content?.parts?.find((part) => "text" in part)?.text ?? "";
      }
    }

    expect(final).toBe("capability:hello");
    expect((await sessionService.getSession({
      appName: "test", userId: "user", sessionId: "session",
    }))?.events).toHaveLength(2);
  });
});
