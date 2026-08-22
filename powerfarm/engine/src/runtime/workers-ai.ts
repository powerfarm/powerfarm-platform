import { randomUUID } from "node:crypto";
import type { LlmRequest, LlmResponse } from "../adk.js";
import { isRecord } from "./json.js";
import type { ModelCapability, ModelGenerationOptions } from "./model.js";

export interface WorkersAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface WorkersMessage { role: "system" | "user" | "assistant" | "tool"; content: string }
interface WorkersTool { name: string; description?: string; parameters: unknown }

function jsonText(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

function contentText(content: unknown): string {
  if (!isRecord(content) || !Array.isArray(content.parts)) return "";
  const values: string[] = [];
  for (const part of content.parts) {
    if (!isRecord(part)) continue;
    if (typeof part.text === "string") values.push(part.text);
    else if (isRecord(part.functionCall)) values.push(jsonText(part.functionCall));
    else if (isRecord(part.functionResponse)) values.push(jsonText(part.functionResponse.response));
  }
  return values.join("\n");
}

function messages(request: LlmRequest): WorkersMessage[] {
  const result: WorkersMessage[] = [];
  const system = request.config?.systemInstruction;
  if (typeof system === "string") result.push({ role: "system", content: system });
  else if (system !== undefined) {
    const text = contentText(system);
    if (text !== "") result.push({ role: "system", content: text });
  }
  for (const content of request.contents) {
    const hasFunctionResponse = content.parts?.some((part) => "functionResponse" in part) ?? false;
    const role = hasFunctionResponse ? "tool" : content.role === "model" ? "assistant" : "user";
    result.push({ role, content: contentText(content) });
  }
  return result;
}

function tools(request: LlmRequest): WorkersTool[] {
  const result: WorkersTool[] = [];
  const configured = request.config?.tools;
  if (!Array.isArray(configured)) return result;
  for (const group of configured) {
    if (!isRecord(group) || !Array.isArray(group.functionDeclarations)) continue;
    for (const declaration of group.functionDeclarations) {
      if (!isRecord(declaration) || typeof declaration.name !== "string") continue;
      result.push({
        name: declaration.name,
        description: typeof declaration.description === "string" ? declaration.description : undefined,
        parameters: declaration.parametersJsonSchema ?? declaration.parameters ?? { type: "object" },
      });
    }
  }
  return result;
}

function toolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch {
      // A malformed provider tool call is rejected below, never executed.
    }
  }
  throw new Error("Workers AI returned invalid tool-call arguments");
}

function responseParts(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error("Workers AI returned an invalid response");
  if (Array.isArray(value.tool_calls) && value.tool_calls.length > 0) {
    return value.tool_calls.map((call) => {
      if (!isRecord(call) || typeof call.name !== "string") {
        throw new Error("Workers AI returned an invalid tool call");
      }
      return { functionCall: {
        id: `adk-${randomUUID()}`,
        name: call.name,
        args: toolArguments(call.arguments),
      } };
    });
  }
  if (typeof value.response !== "string") throw new Error("Workers AI response contained no text");
  return [{ text: value.response }];
}

/** Explicit Workers AI binding adapter; no provider token exists in this object. */
export class WorkersAiModelCapability implements ModelCapability {
  constructor(
    private readonly binding: WorkersAiBinding,
    readonly model: string,
  ) {}

  async *generate(request: LlmRequest, options: ModelGenerationOptions): AsyncIterable<LlmResponse> {
    if (options.abortSignal?.aborted) throw new DOMException("Invocation aborted", "AbortError");
    const declaredTools = tools(request);
    const response = await this.binding.run(this.model, {
      messages: messages(request),
      ...(declaredTools.length > 0 ? { tools: declaredTools } : {}),
      stream: false,
    });
    yield {
      content: { role: "model", parts: responseParts(response) },
      turnComplete: true,
      modelVersion: this.model,
    };
  }
}
