// @google/adk@1.6.0 compatibility boundary.
//
// Do not replace these narrow imports with `@google/adk`: the aggregate Node
// entrypoint eagerly loads Express/body-parser and fails at workerd startup.
// The package's `dist/web` build also contains JavaScript Wrangler 4.118.0
// cannot parse. This exact ESM surface is runtime-tested and the dependency is
// pinned, so any upgrade must update the compatibility report and tests first.

type AdkPublic = typeof import("@google/adk");

// The runtime package does not publish declarations for its deep ESM paths.
// Each deliberately suppressed import is immediately narrowed back to the
// corresponding public ADK type, so `any` cannot escape this one compatibility
// file into Powerfarm code.
// @ts-expect-error @google/adk does not export this runtime subpath.
import { LlmAgent as RuntimeLlmAgent } from "../node_modules/@google/adk/dist/esm/agents/llm_agent.js";
// @ts-expect-error @google/adk does not export this runtime subpath.
import { SequentialAgent as RuntimeSequentialAgent } from "../node_modules/@google/adk/dist/esm/agents/sequential_agent.js";
// @ts-expect-error @google/adk does not export this runtime subpath.
import { createResumabilityConfig as runtimeCreateResumabilityConfig } from "../node_modules/@google/adk/dist/esm/apps/resumability_config.js";
// @ts-expect-error @google/adk does not export this runtime subpath.
import { BaseCodeExecutor as RuntimeBaseCodeExecutor } from "../node_modules/@google/adk/dist/esm/code_executors/base_code_executor.js";
// @ts-expect-error @google/adk does not export this runtime subpath.
import { CodeExecutionLanguage as RuntimeCodeExecutionLanguage } from "../node_modules/@google/adk/dist/esm/code_executors/code_execution_utils.js";
// @ts-expect-error @google/adk does not export this runtime subpath.
import { isFinalResponse as runtimeIsFinalResponse } from "../node_modules/@google/adk/dist/esm/events/event.js";
// @ts-expect-error @google/adk does not export this runtime subpath.
import { BaseLlm as RuntimeBaseLlm } from "../node_modules/@google/adk/dist/esm/models/base_llm.js";
// @ts-expect-error @google/adk does not export this runtime subpath.
import { Runner as RuntimeRunner } from "../node_modules/@google/adk/dist/esm/runner/runner.js";
// @ts-expect-error @google/adk does not export this runtime subpath.
import { BaseSessionService as RuntimeBaseSessionService } from "../node_modules/@google/adk/dist/esm/sessions/base_session_service.js";
// @ts-expect-error @google/adk does not export this runtime subpath.
import { InMemorySessionService as RuntimeInMemorySessionService } from "../node_modules/@google/adk/dist/esm/sessions/in_memory_session_service.js";
// @ts-expect-error @google/adk does not export this runtime subpath.
import { createSession as runtimeCreateSession } from "../node_modules/@google/adk/dist/esm/sessions/session.js";
// @ts-expect-error @google/adk does not export this runtime subpath.
import { FunctionTool as RuntimeFunctionTool } from "../node_modules/@google/adk/dist/esm/tools/function_tool.js";
// @ts-expect-error @google/adk does not export this runtime subpath.
import { requestInputTool as runtimeRequestInputTool } from "../node_modules/@google/adk/dist/esm/tools/request_input_tool.js";

export const LlmAgent: AdkPublic["LlmAgent"] = RuntimeLlmAgent;
export const SequentialAgent: AdkPublic["SequentialAgent"] = RuntimeSequentialAgent;
export const createResumabilityConfig: AdkPublic["createResumabilityConfig"] = runtimeCreateResumabilityConfig;
export const BaseCodeExecutor: AdkPublic["BaseCodeExecutor"] = RuntimeBaseCodeExecutor;
export const CodeExecutionLanguage: AdkPublic["CodeExecutionLanguage"] = RuntimeCodeExecutionLanguage;
export type CodeExecutionLanguage = import("@google/adk").CodeExecutionLanguage;
export const isFinalResponse: AdkPublic["isFinalResponse"] = runtimeIsFinalResponse;
export const BaseLlm: AdkPublic["BaseLlm"] = RuntimeBaseLlm;
export const Runner: AdkPublic["Runner"] = RuntimeRunner;
export const BaseSessionService: AdkPublic["BaseSessionService"] = RuntimeBaseSessionService;
export const InMemorySessionService: AdkPublic["InMemorySessionService"] = RuntimeInMemorySessionService;
export const createSession: AdkPublic["createSession"] = runtimeCreateSession;
export const FunctionTool: AdkPublic["FunctionTool"] = RuntimeFunctionTool;
export const requestInputTool: AdkPublic["requestInputTool"] = runtimeRequestInputTool;

export type {
  AppendEventRequest,
  BaseAgent,
  BaseTool,
  CreateSessionRequest,
  DeleteSessionRequest,
  GetSessionRequest,
  ListSessionsRequest,
  ListSessionsResponse,
} from "@google/adk";
export type {
  CodeExecutionInput,
  CodeExecutionResult,
  Event,
  ExecuteCodeParams,
  LlmRequest,
  LlmResponse,
  Session,
} from "@google/adk";

export const ADK_VERSION = "1.6.0" as const;
