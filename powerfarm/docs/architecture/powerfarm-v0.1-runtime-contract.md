# Powerfarm v0.1 runtime contract

## Status

This document describes the runtime architecture that already exists in the canonical source baseline. It is not the future generalized product API and it is not proof of current live Cloudflare state.

The current vertical slice is `hello-agentic`, used to prove the architecture end to end before generalizing it across arbitrary Gadgets and capabilities.

## One sentence

Powerfarm resolves the exact executable world in the Registry, authorizes it through the Gatekeeper, carries that authority in a `RunGrant` and `ExecutionEnvelope`, and lets a thin private Engine execute the exact snapshot with ADK.

## Roles

### Workspace / Workspace LLM

The Workspace operates Powerfarm through typed capabilities. It must not receive OAuth bearer tokens, refresh tokens, Supabase secrets, Engine URLs, arbitrary runtime bindings, or raw authority objects.

The current v0.1 capability is intentionally narrow (`hello.run` plus draft/change/publish/resume methods) so that the security and lineage model can be proved before generalizing discovery.

### Identity

Identity answers **who is this actor?**

The Identity Gatekeeper may retain OAuth material internally and refresh a user access token when needed. Identity alone does not decide that an operation is authorized.

### Registry

Registry is durable truth for the exact Powerfarm world. For execution it resolves:

- actor / principal;
- workspace;
- installed capability;
- Gadget lineage;
- immutable Gadget revision;
- source hash;
- definition hash;
- operation;
- authority version.

It also owns Gadget draft and publication lineage, run grants, execution envelopes, run/session persistence contracts, and RLS-backed containment.

### Gatekeeper / authority broker

The Gatekeeper converts a typed Workspace capability into exact Registry authority. The caller is not allowed to nominate an arbitrary workspace, Gadget, revision, source, or grant.

The current `PowerfarmAuthorityBroker.helloRun()` contract is:

```text
IdentityContext
-> select the authorized v0.1 workspace
-> resolve capability hello.run
-> issue exact RunGrant
-> build ExecutionEnvelope
-> invoke private Engine WorkspaceRuntime
```

### RunGrant

`RunGrant` is the durable authorization fact for a specific execution intent. It pins the resolved capability and immutable Gadget revision/hash under an authority version and idempotency key.

A human bearer token is authentication context for interactive RLS access; it is not the durable authorization object of the run.

### ExecutionEnvelope

`ExecutionEnvelope` is the strict handoff into Engine. It carries the exact resolved world needed to execute or resume and is verified before the runtime starts.

The Engine must not mutate the authority semantics represented by the envelope.

### Engine

`powerfarm-engine` exposes the named `WorkspaceRuntime` entrypoint to the Identity Worker through a private Cloudflare service binding.

Its narrow v0.1 RPC surface is:

```text
validateGadget
invokeGadget
resumeRun
```

The default HTTP export is diagnostic only. Invocation is not a public HTTP API.

Engine receives a delegated caller bearer only for interactive Supabase/RLS context and must not persist or expose it.

### ADK

Google ADK owns agent and workflow execution semantics. Powerfarm adds identity, authority, exact artifact resolution, persistence, observability, version pinning, capability bindings, and Gadget packaging around ADK.

Powerfarm must not create a competing workflow state-machine language.

## Operate contract

```text
PowerfarmSession.helloRun(input, idempotencyKey)
  -> fresh authenticated caller context
  -> powerfarm_identity_context()
  -> powerfarm_resolve_execution(workspace, "hello.run")
  -> powerfarm_issue_run_grant(exact resolved revision/hashes)
  -> powerfarm_execution_envelope(runGrant, input, idempotencyKey)
  -> ENGINE.invokeGadget(envelope, delegatedBearer)
  -> verify envelope
  -> construct caller-scoped Supabase database
  -> compile exact Gadget source
  -> compile exact ADK representation
  -> create/reuse idempotent run
  -> execute ADK
  -> persist run/session/events/checkpoints
  -> return sanitized result + provenance
```

### Invocation invariants

- retrying the same idempotency key returns the same durable run;
- a run is pinned to exact Gadget definition/revision provenance;
- capability authority is resolved before runtime execution begins;
- no arbitrary source can bypass Registry lineage via `invokeGadget`;
- caller-visible results contain no bearer or refresh credentials.

## Change contract

The current draft/edit/publish flow intentionally gives the Workspace capability and Registry UI the same source of truth.

```text
get draft
-> draft revision + authored state
-> apply patch(baseRevision, patch, clientOperationId)
-> compare-and-set
-> stale base => revision_conflict
-> validate canonical gadget.yaml through private Engine
-> publish(baseRevision, definitionHash)
-> immutable published revision + hashes
```

The next invocation resolves the published revision from Registry; it does not execute a private bundled copy owned by Engine.

### Lineage invariants

- draft is mutable only through optimistic concurrency;
- published revisions are immutable;
- source and definition hashes are pinned in authority/provenance;
- an already-running execution remains reproducible against its original revision even if the draft changes later.

## Sleep contract

A waiting run is durable state, not a suspended in-memory object.

```text
created
-> running
-> waiting_input
-> running
-> completed
```

When ADK requests input, Powerfarm persists the pending call/checkpoint and returns a typed waiting result. Resume builds a fresh Engine service/runtime/ADK Runner from durable state and passes the function response back into ADK.

### Resume invariants

- no in-memory Engine/Runner object is required to survive the pause;
- the resumed run must belong to the same immutable Gadget definition;
- run/session ownership remains enforced under caller identity;
- duplicate or invalid transitions are rejected by durable compare-and-set state changes.

## Approval boundaries

Three concepts must remain separate:

| Mechanism | Question |
| --- | --- |
| ADK HITL | What information or workflow decision is needed to continue? |
| Gatekeeper approval | May this actor use this capability with side effects? |
| Registry/governance | Has this artifact/version/action become an institutional fact? |

A security approval must not be disguised as an ordinary ADK chat question.

## Credentials and RLS

Interactive runtime access uses:

```text
Supabase publishable key
+
fresh delegated user JWT
+
RLS / narrow RPC boundaries
```

Engine must not gain a broad Supabase `service_role` credential as a convenience shortcut.

Identity may refresh OAuth credentials internally. The Workspace LLM, Gadget, Engine run record, ADK session, logs, and returned result must never receive the refresh token.

## Long-running authority

The durable authority of a run is the `RunGrant`, not a stored human JWT.

The current interactive vertical slice may use a fresh bearer when invoking/resuming. Future autonomous continuation must use a narrowly scoped Powerfarm machine/runtime principal or equivalent privileged boundary tied to the existing run authorization model, never a persisted human refresh token and never an unrestricted Engine service-role shortcut.

## Product boundary

`invokeGadget` is a runtime primitive.

The intended Workspace product surface is typed capability use, conceptually:

```text
LLM sees:       hello.run({ message: "Hello" })
Runtime receives: exact resolved ExecutionEnvelope
```

The generalized capability catalog comes later. v0.1 deliberately proves the authority model with a narrow vertical slice first.

## Proof boundary

The historical dated proof is in `docs/powerfarm-v0.1-platform-proof.md`.

That proof established Operate, Change, Sleep, private Engine binding, RLS containment, exact revision provenance, and token redaction at the recorded time. Current production topology must always be re-read from live systems before a deployment decision.
