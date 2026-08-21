import { compileGadgetYaml, type CompiledGadget } from "../contracts/gadget.js";
import { isRecord } from "./json.js";

export interface ExecutionEnvelope {
  envelopeVersion: "powerfarm.execution/v0.1";
  principalRef: string;
  workspaceRef: string;
  capabilityRef: string;
  gadgetRef: string;
  gadgetRevision: number;
  gadgetRevisionHash: string;
  gadgetDefinitionHash: string;
  gadgetVersion: string;
  operation: "run" | "resume";
  input: unknown;
  gadgetSource: string;
  runGrantRef: string;
  runRef?: string;
  allowedCapabilities: string[];
  idempotencyKey: string;
  authorityVersion: number;
  issuedAt: string;
  expiresAt: string;
}

export interface VerifiedExecutionEnvelope {
  envelope: ExecutionEnvelope;
  gadget: CompiledGadget;
}

export class ExecutionEnvelopeError extends Error {
  constructor(message: string) {
    super(`Invalid ExecutionEnvelope: ${message}`);
    this.name = "ExecutionEnvelopeError";
  }
}

const envelopeKeys = new Set([
  "envelope_version", "principal_ref", "workspace_ref", "capability_ref", "gadget_ref",
  "gadget_revision", "gadget_revision_hash", "gadget_definition_hash", "gadget_version",
  "operation", "input", "gadget_source", "run_grant_ref", "allowed_capabilities",
  "idempotency_key", "authority_version", "issued_at", "expires_at", "run_ref",
]);
const requiredEnvelopeKeys = [...envelopeKeys].filter((key) => key !== "run_ref");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
const logicalRef = /^[a-z][a-z0-9.-]{0,199}$/;

function string(value: unknown, field: string, pattern?: RegExp, maxLength = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength
    || (pattern !== undefined && !pattern.test(value))) {
    throw new ExecutionEnvelopeError(`invalid ${field}`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ExecutionEnvelopeError(`invalid ${field}`);
  }
  return value as number;
}

function timestamp(value: unknown, field: string): string {
  const parsed = string(value, field);
  if (!Number.isFinite(Date.parse(parsed))) throw new ExecutionEnvelopeError(`invalid ${field}`);
  return parsed;
}

function capabilities(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new ExecutionEnvelopeError("invalid allowed_capabilities");
  }
  const result = value.map((item) => string(item, "allowed_capabilities item", logicalRef));
  if (new Set(result).size !== result.length) {
    throw new ExecutionEnvelopeError("duplicate allowed_capabilities");
  }
  return result;
}

export function parseExecutionEnvelope(value: unknown, now = new Date()): ExecutionEnvelope {
  if (!isRecord(value)) throw new ExecutionEnvelopeError("object required");
  for (const key of Object.keys(value)) {
    if (!envelopeKeys.has(key)) throw new ExecutionEnvelopeError(`unknown field ${key}`);
  }
  for (const key of requiredEnvelopeKeys) {
    if (!(key in value)) throw new ExecutionEnvelopeError(`missing field ${key}`);
  }

  const envelopeVersion = string(value.envelope_version, "envelope_version");
  if (envelopeVersion !== "powerfarm.execution/v0.1") {
    throw new ExecutionEnvelopeError("unsupported envelope_version");
  }
  const operation = string(value.operation, "operation");
  if (operation !== "run" && operation !== "resume") {
    throw new ExecutionEnvelopeError("unsupported operation");
  }
  const runRef = value.run_ref === undefined ? undefined : string(value.run_ref, "run_ref", uuid);
  if (operation === "resume" && runRef === undefined) {
    throw new ExecutionEnvelopeError("missing field run_ref");
  }
  if (operation === "run" && runRef !== undefined) {
    throw new ExecutionEnvelopeError("run operation cannot include run_ref");
  }
  const issuedAt = timestamp(value.issued_at, "issued_at");
  const expiresAt = timestamp(value.expires_at, "expires_at");
  if (Date.parse(expiresAt) <= now.getTime()) throw new ExecutionEnvelopeError("expired");
  if (Date.parse(issuedAt) >= Date.parse(expiresAt)) {
    throw new ExecutionEnvelopeError("invalid authority interval");
  }

  return Object.freeze({
    envelopeVersion,
    principalRef: string(value.principal_ref, "principal_ref", uuid),
    workspaceRef: string(value.workspace_ref, "workspace_ref", uuid),
    capabilityRef: string(value.capability_ref, "capability_ref", logicalRef),
    gadgetRef: string(value.gadget_ref, "gadget_ref", logicalRef),
    gadgetRevision: positiveInteger(value.gadget_revision, "gadget_revision"),
    gadgetRevisionHash: string(value.gadget_revision_hash, "gadget_revision_hash", hash),
    gadgetDefinitionHash: string(value.gadget_definition_hash, "gadget_definition_hash", hash),
    gadgetVersion: string(value.gadget_version, "gadget_version"),
    operation,
    input: value.input,
    gadgetSource: string(value.gadget_source, "gadget_source", undefined, 256_000),
    runGrantRef: string(value.run_grant_ref, "run_grant_ref", uuid),
    runRef,
    allowedCapabilities: capabilities(value.allowed_capabilities),
    idempotencyKey: string(value.idempotency_key, "idempotency_key"),
    authorityVersion: positiveInteger(value.authority_version, "authority_version"),
    issuedAt,
    expiresAt,
  });
}

export async function verifyExecutionEnvelope(
  envelope: ExecutionEnvelope,
): Promise<VerifiedExecutionEnvelope> {
  const gadget = await compileGadgetYaml(envelope.gadgetSource);
  if (gadget.id !== envelope.gadgetRef) throw new ExecutionEnvelopeError("Gadget ref mismatch");
  if (gadget.version !== envelope.gadgetVersion) {
    throw new ExecutionEnvelopeError("Gadget version mismatch");
  }
  if (gadget.definitionHash !== envelope.gadgetDefinitionHash) {
    throw new ExecutionEnvelopeError("Gadget definition hash mismatch");
  }

  const allowed = new Set(envelope.allowedCapabilities);
  for (const agent of Object.values(gadget.agents)) {
    for (const capability of agent.capabilities) {
      if (!allowed.has(capability)) {
        throw new ExecutionEnvelopeError(`RunGrant does not allow capability ${capability}`);
      }
    }
  }
  return { envelope, gadget };
}
