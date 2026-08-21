# Full Powerfarm platform target

## Status

This is the product-level generalization of the proven v0.1 core. It is intentionally separated from the runtime baseline so future work does not confuse **implemented/proved** with **desired/generalized**.

The v0.1 baseline already proves the hard spine: typed Workspace capability -> IdentityContext -> Registry resolution -> RunGrant -> ExecutionEnvelope -> private `WorkspaceRuntime` -> ADK -> durable Supabase state.

The work below turns that narrow vertical slice into the general Powerfarm platform.

## Target shape

```text
                         POWERFARM PLATFORM

 Human
   |
   v
Workspace UI + Workspace LLM
   |
   | typed Powerfarm capabilities
   v
Powerfarm Identity / Gatekeeper boundary
   |
   +--> Registry: identity context, installs, revisions, grants, governance
   |
   +--> private ENGINE binding
            |
            v
      powerfarm-engine#WorkspaceRuntime
            |
            v
          Google ADK
            |
            v
      durable Supabase state
```

The Workspace LLM is not an HTTP client to Engine and does not get raw Engine authority.

## General capability surface

The current `hello*` methods should evolve into discovered typed capabilities rather than a universal free-form runtime command.

### Runtime-facing capabilities

Conceptually:

- start an authorized Gadget operation;
- inspect a durable run;
- inspect output/events since a cursor;
- resume a run waiting for workflow input;
- request cancellation where the runtime supports it.

The product tool name may be specific to the installed capability (`invoice.create`, `crm.lookup`, `hello.run`, etc.). Internally these may resolve to the Engine runtime primitive `invokeGadget`, but the LLM should not choose raw revision/source/grant facts.

### Gadget authoring capabilities

Generalize the proven draft/publish path to:

- discover Gadgets available to the actor/workspace;
- read metadata and current draft;
- retrieve exact historical revisions;
- apply optimistic patches against a known draft revision;
- validate canonical source;
- publish immutable revisions;
- inspect lineage and hashes.

### Installation capabilities

Installation must become a first-class authority object rather than a metadata dead end:

- inspect current installation;
- install a Gadget with explicit capability grants;
- update permitted version/range under policy;
- uninstall/revoke future authority;
- preserve already-issued run provenance without silently rewriting history.

## One Gadget definition

The product must converge on one lineage:

```text
Gadget identity
   |
   +--> mutable draft
   |       |
   |       +--> Platform UI edits
   |       +--> Workspace LLM edits
   |
   +--> immutable published revisions
             |
             +--> install resolves authority
             +--> Engine executes exact revision/hash
```

Engine owns validation/resolution adapters and execution, not a parallel canonical copy of Gadget source.

## Generalized execution resolution

A typed capability call should resolve approximately like this:

```text
authenticated actor
-> authorized workspace context
-> requested capability ref
-> installation that provides it
-> exact allowed Gadget revision
-> immutable source + hashes
-> operation schema
-> Gatekeeper authorization / approval policy
-> RunGrant
-> ExecutionEnvelope
-> private Engine execution
```

Any product API that lets the caller skip directly to arbitrary Gadget source or revision is a regression.

## Long-running and autonomous runs

Interactive invocations may carry a fresh delegated user bearer into Engine solely for caller-scoped RLS access.

Unattended continuation must not persist or refresh a human token in Engine. The target is a narrow Powerfarm machine/runtime principal or equivalent privileged boundary whose authority is derived from the already-issued `RunGrant`, with explicit expiry/revocation and exact run/workspace/Gadget scope.

The durable run authorization model therefore exists now; only the autonomous principal mechanism is future work.

## Approval model

Keep three layers distinct as the product expands:

1. **ADK HITL**: information or workflow decision required to continue the graph.
2. **Gatekeeper capability approval**: permission for a side-effecting capability use.
3. **Registry/governance approval**: institutional promotion, publication, installation, or policy fact.

Sensitive installs, destructive edits, publication, permission changes, and high-impact external actions can require Gatekeeper/governance approval without becoming ordinary ADK prompts.

## Observability target

Every hop should carry non-secret correlation/provenance identifiers such as:

```text
workspace_ref
conversation_id
tool_call_id
request_id
run_id
run_grant_ref
gadget_ref
gadget_revision
gadget_revision_hash
gadget_definition_hash
capability_ref
authority_version
```

Credential material must never be part of structured runtime provenance.

## Security definition of done

The generalized platform is green when all of these hold simultaneously:

- Workspace LLM can operate installed Powerfarm capabilities without learning a JWT or Engine URL;
- Identity is the only Workspace broker to the private Engine runtime;
- Registry resolves exact installation/revision/source truth;
- Gatekeeper authorization is explicit and separate from identity;
- Engine executes only verified envelopes and remains thin;
- one Gadget lineage is editable by UI and LLM and executable by Engine;
- immutable published revisions make old runs reproducible;
- WAITING/resume survives process reconstruction;
- cross-user/cross-workspace run access fails;
- uninstalled or unauthorized capability use fails;
- stale edits conflict instead of overwriting;
- token/secret leakage tests remain deployment blockers;
- public Engine invocation remains unavailable;
- autonomous continuation does not depend on persisted human refresh tokens.

## Migration strategy from the v0.1 slice

Generalize outward from the proved `hello-agentic` seam instead of replacing it:

```text
1. preserve exact authority/envelope contract
2. replace hard-coded hello capability lookup with generic capability discovery
3. generalize Gadget draft/publish APIs using the same optimistic lineage model
4. make installations/grants generic and policy-aware
5. add run inspection/events/cancellation as narrow runtime capabilities
6. add approval UX without merging it with ADK HITL
7. add autonomous machine-principal continuation under RunGrant scope
8. keep every step behind deterministic tests, RLS tests, Wrangler dry-runs and live proof
```

The goal is not to make Engine bigger. The goal is to make the Registry/Gatekeeper contract general while Engine keeps doing one job: run the exact authorized world with ADK.
