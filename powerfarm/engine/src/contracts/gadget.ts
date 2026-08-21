import { createHash } from "node:crypto";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parseDocument } from "yaml";
import schema from "./gadget.schema.json";

export type CapabilityKind = "model" | "gatekeeper" | "input" | "code-executor";

export interface GadgetCapability {
  kind: CapabilityKind;
  target: string;
}

export interface GadgetAgent {
  model: { capability: string };
  instruction: string;
  capabilities: string[];
}

export interface GadgetFlow {
  sequence: Array<{ agent: string }>;
}

export interface GadgetV01 {
  apiVersion: "powerfarm.app/v1alpha1";
  kind: "Gadget";
  metadata: { id: string; version: string };
  spec: {
    agentic: { runtime: "adk-js" };
    agents: Record<string, GadgetAgent>;
    flows: Record<string, GadgetFlow>;
    capabilities: Record<string, GadgetCapability>;
  };
}

export interface CompiledAgent {
  id: string;
  instruction: string;
  modelCapability: string;
  capabilities: string[];
}

export interface CompiledGadget {
  id: string;
  version: string;
  definitionHash: string;
  placement: "cloudflare-adk-js";
  agents: Record<string, CompiledAgent>;
  capabilities: Record<string, GadgetCapability>;
  flow: { id: string; sequence: string[] };
}

export class GadgetContractError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message);
    this.name = "GadgetContractError";
  }
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: false,
});
addFormats(ajv);
const validateSchema = ajv.compile<GadgetV01>(schema);

function schemaIssue(error: ErrorObject): string {
  const location = error.instancePath || "/";
  return `${location} ${error.message ?? error.keyword}`;
}

function semanticIssues(gadget: GadgetV01): string[] {
  const issues: string[] = [];
  const capabilityNames = new Set(Object.keys(gadget.spec.capabilities));
  const agentNames = new Set(Object.keys(gadget.spec.agents));

  for (const [agentId, agent] of Object.entries(gadget.spec.agents)) {
    if (!capabilityNames.has(agent.model.capability)) {
      issues.push(`agent ${agentId} references missing model capability ${agent.model.capability}`);
    } else if (gadget.spec.capabilities[agent.model.capability]?.kind !== "model") {
      issues.push(`agent ${agentId} model capability must have kind model`);
    }
    for (const capability of agent.capabilities) {
      if (!capabilityNames.has(capability)) {
        issues.push(`agent ${agentId} references missing capability ${capability}`);
      }
    }
    if (!agent.capabilities.includes(agent.model.capability)) {
      issues.push(`agent ${agentId} must include its model capability in capabilities`);
    }
  }

  for (const [flowId, flow] of Object.entries(gadget.spec.flows)) {
    for (const step of flow.sequence) {
      if (!agentNames.has(step.agent)) {
        issues.push(`flow ${flowId} references missing agent ${step.agent}`);
      }
    }
  }
  if (!("default" in gadget.spec.flows)) {
    issues.push("a default flow is required in v0.1");
  }
  return issues;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

export function canonicalGadgetJson(gadget: GadgetV01): string {
  return JSON.stringify(sortValue(gadget));
}

export function parseGadgetYaml(source: string): GadgetV01 {
  if (source.length > 256_000) {
    throw new GadgetContractError("Gadget source exceeds 256 KB");
  }

  const document = parseDocument(source, {
    schema: "core",
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    const issues = document.errors.map((error) => error.message);
    throw new GadgetContractError(`Invalid Gadget YAML: ${issues.join("; ")}`, issues);
  }

  const value: unknown = document.toJS({ maxAliasCount: 0 });
  if (!validateSchema(value)) {
    const issues = (validateSchema.errors ?? []).map(schemaIssue);
    throw new GadgetContractError(`Gadget schema validation failed: ${issues.join("; ")}`, issues);
  }
  const issues = semanticIssues(value);
  if (issues.length > 0) {
    throw new GadgetContractError(`Gadget semantic validation failed: ${issues.join("; ")}`, issues);
  }
  return value;
}

export async function compileGadgetYaml(source: string): Promise<CompiledGadget> {
  const gadget = parseGadgetYaml(source);
  const canonical = canonicalGadgetJson(gadget);
  const definitionHash = createHash("sha256").update(canonical).digest("hex");
  const flow = gadget.spec.flows.default;

  return {
    id: gadget.metadata.id,
    version: gadget.metadata.version,
    definitionHash,
    placement: "cloudflare-adk-js",
    agents: Object.fromEntries(
      Object.entries(gadget.spec.agents).map(([id, agent]) => [id, {
        id,
        instruction: agent.instruction.trim(),
        modelCapability: agent.model.capability,
        capabilities: [...agent.capabilities],
      }]),
    ),
    capabilities: structuredClone(gadget.spec.capabilities),
    flow: {
      id: "default",
      sequence: flow.sequence.map(({ agent }) => agent),
    },
  };
}
