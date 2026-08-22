# ADR 0001: Stateless Compute, Durable Truth

Status: accepted for Powerfarm v0.1 — 2026-08-19

## Decision

Supabase is Powerfarm's durable, always-addressable substrate. Runs, ADK
sessions/events, checkpoints, effect claims, provenance, and idempotency facts
are persisted there under caller-JWT/RLS authority.

Compute is summonable and disposable. `pf.engine` names a logical agentic
runtime capability, not a permanent server. A Worker may hydrate one run,
advance it, commit durable truth, and disappear.

The Gadget owns its agent and flow definitions. Powerfarm deterministically
validates and compiles Gadget YAML; the runtime does not own a global set of
Powerfarm agents. ADK-JS is the v0.1 implementation substrate behind the
Powerfarm runtime boundary.

Registry owns one Gadget lineage: a concurrency-controlled mutable draft and
immutable published revisions. IdentityContext says who is acting; Registry
resolves the installed revision; Gatekeeper issues authority for that exact
snapshot; the Engine executes only the resulting strict ExecutionEnvelope.
The Engine neither resolves `published` nor accepts caller-authored YAML.

Capabilities—not secrets—cross into the agent runtime. Model, Gatekeeper, and
execution authority is explicitly injected. Gadget YAML, ADK state, Dynamic
Worker source, run rows, and logs must not contain provider credentials.

The existing Cloudflare OS Dynamic Worker code-mode path remains the code
isolation boundary. Powerfarm supplies an ADK `BaseCodeExecutor` adapter, but it
does not create another Loader binding or execute Gadget code in the Engine.

An MCP “server” is a protocol role. If added, its transport may resolve a
capability, perform a stateless request, commit application state externally,
respond, and disappear; MCP does not imply process residency.

## Consequences

- A later request can resume after the previous Worker isolate is gone.
- Effects are claimed before execution and replayed after completion; ambiguous
  timeouts become `uncertain`, never an automatic duplicate.
- Supabase remains the only canonical agent-session ledger. No Engine Durable
  Object or D1 database is introduced.
- Placement is currently `cloudflare-adk-js`, but Gadget semantics contain no
  Cloudflare binding details.
- `WorkspaceRuntime` is a private named Worker RPC entrypoint bound only to the
  Powerfarm Identity/Capability Gatekeeper. Public HTTP invocation is absent.
- A RunGrant pins principal, workspace, capability, Gadget revision and hashes,
  allowed capabilities, authority version, expiry, and idempotency key. It
  stores no OAuth bearer or provider credential.
