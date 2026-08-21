import {
  LlmAgent,
  SequentialAgent,
  requestInputTool,
  type BaseAgent,
  type BaseTool,
} from "../adk.js";
import type { CompiledGadget } from "../contracts/gadget.js";
import { PowerfarmCodeExecutor, type CodeExecutionCapability } from "./code-executor.js";
import { PowerfarmModel, type ModelCapability } from "./model.js";

export interface CapabilityBindings {
  models: Record<string, ModelCapability>;
  codeExecutors: Record<string, CodeExecutionCapability>;
  tools: Record<string, BaseTool[]>;
}

export interface AdkGadgetRuntime {
  rootAgent: BaseAgent;
  agents: Record<string, InstanceType<typeof LlmAgent>>;
}

export class MissingCapabilityError extends Error {
  constructor(readonly capabilityId: string, readonly agentId: string) {
    super(`Agent ${agentId} requires unavailable capability ${capabilityId}`);
    this.name = "MissingCapabilityError";
  }
}

function requireBinding<T>(
  bindings: Record<string, T>,
  capabilityId: string,
  agentId: string,
): T {
  const binding = bindings[capabilityId];
  if (binding === undefined) throw new MissingCapabilityError(capabilityId, agentId);
  return binding;
}

/** Compile a provider-neutral Gadget plan into a Gadget-owned ADK tree. */
export function compileAdkGadget(
  gadget: CompiledGadget,
  bindings: CapabilityBindings,
): AdkGadgetRuntime {
  // Resolve every authority before constructing an ADK agent. A missing
  // capability therefore cannot cause a partial invocation or external effect.
  for (const agentId of gadget.flow.sequence) {
    const agent = gadget.agents[agentId];
    if (agent === undefined) throw new Error(`Compiled flow references unknown agent ${agentId}`);
    requireBinding(bindings.models, agent.modelCapability, agentId);
    for (const capabilityId of agent.capabilities) {
      const capability = gadget.capabilities[capabilityId];
      if (capability === undefined) throw new MissingCapabilityError(capabilityId, agentId);
      if (capability.kind === "model") requireBinding(bindings.models, capabilityId, agentId);
      if (capability.kind === "gatekeeper") requireBinding(bindings.tools, capabilityId, agentId);
      if (capability.kind === "code-executor") {
        requireBinding(bindings.codeExecutors, capabilityId, agentId);
      }
    }
  }

  const agents: Record<string, InstanceType<typeof LlmAgent>> = {};
  const flowAgents = gadget.flow.sequence.map((agentId) => {
    const definition = gadget.agents[agentId];
    if (definition === undefined) throw new Error(`Compiled flow references unknown agent ${agentId}`);

    const tools: BaseTool[] = [];
    let codeExecutor: PowerfarmCodeExecutor | undefined;
    for (const capabilityId of definition.capabilities) {
      const capability = gadget.capabilities[capabilityId];
      if (capability?.kind === "input") tools.push(requestInputTool);
      if (capability?.kind === "gatekeeper") tools.push(...requireBinding(bindings.tools, capabilityId, agentId));
      if (capability?.kind === "code-executor") {
        if (codeExecutor !== undefined) {
          throw new Error(`Agent ${agentId} declares more than one code executor`);
        }
        codeExecutor = new PowerfarmCodeExecutor(
          capabilityId,
          requireBinding(bindings.codeExecutors, capabilityId, agentId),
        );
      }
    }

    const agent = new LlmAgent({
      name: definition.id,
      description: `Powerfarm Gadget agent ${definition.id}`,
      instruction: definition.instruction,
      model: new PowerfarmModel(
        definition.modelCapability,
        requireBinding(bindings.models, definition.modelCapability, agentId),
      ),
      tools,
      codeExecutor,
    });
    agents[agentId] = agent;
    return agent;
  });

  const rootAgent = new SequentialAgent({
    name: "defaultFlow",
    description: `Default flow for Gadget ${gadget.id}`,
    subAgents: flowAgents,
  });
  return { rootAgent, agents };
}
