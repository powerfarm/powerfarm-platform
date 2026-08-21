# Powerfarm canonical baseline

## Purpose

This repository is the clean canonical baseline for Powerfarm. It does not continue the Git history of `powerfarm/OLD-platform-NAO-USAR-os` and must not depend on any `OLD-*` repository at runtime, build time, or deploy time.

This is intentionally a **rich baseline**, not a blank starter. It preserves the Powerfarm v0.1 runtime architecture that was already implemented and proved, while removing migration baggage, unsafe shortcuts, stale deployment assumptions, and dead-end experiments.

## Upstream root

Cloudflare OS is consumed as the official upstream submodule:

- repository: `https://github.com/cloudflare/cloudflare-os.git`
- pinned commit: `bf7f762d7fa73553284d731ab6a978d3ea17be24`

The pin is deliberate. Upstream upgrades are explicit reviewed changes, never ambient drift.

## Powerfarm provenance

The reviewed Powerfarm source layer was reapplied from the final legacy snapshot:

- legacy repository: `powerfarm/OLD-platform-NAO-USAR-os`
- reviewed snapshot: `350dc661bdd1c4d831e5eb1f6b9224a9050de88e`
- canonical runtime baseline commit in this repository: `570715a75ddf40288834e0249f37e77754034511`

The legacy SHA is provenance only. The copied files are first-class canonical source here.

## Sources of truth

Different facts have different authorities:

| Fact | Canonical authority |
| --- | --- |
| Cloudflare OS source | pinned `cloudflare-os/` gitlink |
| Powerfarm runtime source | this repository |
| Powerfarm artifact/install/revision/run truth | Registry / Supabase |
| Human authentication | Powerfarm Identity / OAuth issuer |
| Capability authorization | Gatekeeper + exact Registry resolution |
| Workflow execution semantics | Google ADK |
| Worker names and account configuration | `deployment.jsonc` |
| Live Worker topology/version | Cloudflare API evidence, never repository prose |
| Historical migration provenance | `state/legacy-production-baseline.json` and migration state |

Documentation must never be treated as proof of current live Cloudflare state.

## Canonical runtime topology

The v0.1 authority path is intentionally asymmetric:

```text
Workspace / Workspace LLM
        |
        | typed Powerfarm capability
        v
Powerfarm Identity Gatekeeper
        |
        | IdentityContext + Registry resolution
        v
exact installed capability + immutable Gadget revision
        |
        v
RunGrant
        |
        v
ExecutionEnvelope
        |
        | private ENGINE service binding
        v
powerfarm-engine#WorkspaceRuntime
        |
        v
Google ADK
        |
        v
Supabase persistence under delegated caller identity / RLS
```

Only Identity brokers the private `WorkspaceRuntime` binding. Router, Workshop/backend, Custom Gatekeeper, and arbitrary Gadgets do not receive `ENGINE`.

The Engine is a thin runtime. It does not choose the caller's workspace, installation, Gadget, revision, source, grant, or capability. Those facts are resolved before invocation and carried in a strict `ExecutionEnvelope`.

## Core invariants

- Identity proves who the actor is; identity is not authority.
- Registry is durable truth and resolves the exact executable world.
- Gatekeeper authorizes capability use against that resolved world.
- `RunGrant` is the durable authorization fact for a run.
- Engine receives an `ExecutionEnvelope`; it does not become a second control plane.
- `invokeGadget` is an internal runtime primitive, not the generic Workspace LLM product UX.
- Workspace capabilities are typed and narrow. The caller cannot nominate arbitrary source, revision, workspace, or grant.
- Engine is non-public for invocation and contains no Supabase `service_role` credential.
- Engine may receive a fresh delegated caller bearer for interactive RLS context, but must not persist bearer or refresh tokens in runs, ADK sessions, logs, Gadget state, or results.
- Gadget published revisions are immutable and hash-addressed. Draft edits use optimistic concurrency.
- ADK owns workflow state-machine semantics. Powerfarm wraps ADK with identity, authority, versioning, persistence, observability, and packaging instead of inventing a second workflow language.
- ADK HITL, Gatekeeper capability approval, and Registry/governance approval are separate mechanisms.
- Every mutation is idempotent or compare-and-set guarded where retries are possible.

Doctrine:

`LLM designs it. LLM operates it. Registry remembers it. Gatekeeper authorizes it. ADK runs it. LLM is none of those three.`

And the Engine rule:

`Engine connects those facts without becoming another platform.`

## The v0.1 vertical slice

`hello-agentic` is the current proof vehicle, not a special architectural exception.

### Operate

```text
PowerfarmSession.helloRun
-> IdentityContext
-> installed hello.run resolution
-> RunGrant
-> ExecutionEnvelope
-> private WorkspaceRuntime
-> ADK
-> Supabase
```

The historical live proof returned `HELLO`, pinned an exact immutable Gadget revision and hashes, and proved invocation idempotency.

### Change

The Workspace capability and Registry UI use the same canonical draft RPC and optimistic patch contract. Publishing creates an immutable revision; the next execution is pinned to that exact published revision/hash.

### Sleep

The durable lifecycle is:

```text
created -> running -> waiting_input -> running -> completed
```

Resume reconstructs fresh Engine/runtime/ADK objects from durable state. No in-memory object is allowed to be the authority that crosses a pause.

Historical proof details live in `docs/powerfarm-v0.1-platform-proof.md`. They are evidence of what was proved at the recorded time, not an assertion that live Cloudflare still has the same versions today.

## Deliberately rejected paths

The baseline must not reintroduce shortcuts that were identified as wrong or too dangerous:

- no public HTTP Engine invocation path;
- no `ENGINE` binding on Router, Workshop/backend, Custom Gatekeeper, or random Gadgets;
- no generic LLM `webFetch` or magic internal URL as the runtime bridge;
- no caller-selected arbitrary Gadget YAML passed directly to invocation;
- no caller-selected workspace/revision/grant treated as authority;
- no Supabase `service_role` secret in Engine;
- no stored human refresh token in Engine or durable run state;
- no second Powerfarm workflow graph semantics layered over ADK;
- no arbitrary privileged code execution in Engine and no second `env.LOADER` wrapper while the safe upstream seam is unresolved;
- no generated `dist/**` or `worker-configuration.d.ts` imported as source history;
- no dependency on `OLD-*` repositories after migration;
- no copied legacy deployment anchor whose commit belongs to another Git history;
- no continuous production deploy controller before one-time canonical activation is proved;
- no GitHub secret as a second source of truth for Cloudflare account ID. `deployment.jsonc.accountId` is canonical; a `CLOUDFLARE_ACCOUNT_ID` secret, if present, is intentionally ignored by the workflows.

See `docs/architecture/rejected-paths.md` for the rationale and replacement pattern for each item.

## Production migration gate

Having canonical source does not automatically authorize production writes.

The one-time activation path is intentionally staged:

1. full deterministic/static CI without production credentials;
2. read-only credential preflight against the current canonical account configuration;
3. prove the historical eight-Worker baseline still matches live before any write;
4. prove no runtime debt was introduced after the canonical runtime baseline commit;
5. verify non-Identity Worker drift before write;
6. make the first canonical production write to **Identity only**, because that is the known deployment debt from the reviewed legacy snapshot;
7. prove only Identity changed and public edge smoke remains healthy;
8. create a new `state/ultimo-deploy.json` anchored to a commit from this repository;
9. finalize migration state while keeping continuous production deploy disabled;
10. rollback Identity to the sealed pre-activation version if any post-write proof or durable anchor step fails.

Only after this one-time migration is green may a steady-state production deploy controller be introduced in a separate reviewed change.

## Credential contract

The production GitHub environment is `producao`.

Required secrets:

- `CLOUDFLARE_API_TOKEN_READONLY`: account-owned token scoped for Workers Scripts read;
- `CLOUDFLARE_API_TOKEN`: account-owned deployment token scoped for Workers Scripts write.

The Cloudflare account ID is parsed and validated from `deployment.jsonc`; workflows do not consume `secrets.CLOUDFLARE_ACCOUNT_ID`.

Secret values must never be committed, echoed, attached to issues, or copied into documentation.

## Evidence classes

Keep these categories separate when diagnosing the platform:

- **source proof**: repository code, tests, generated dry-runs;
- **historical live proof**: recorded IDs/hashes/versions from a dated live run;
- **current live proof**: authenticated Cloudflare/Supabase/UI evidence gathered now;
- **target architecture**: intended generalization beyond the current v0.1 vertical slice.

A green source test is not a live deployment proof. A historical version ID is not current topology. A target capability is not implemented merely because it is documented.

## Architecture map

- `docs/architecture/powerfarm-v0.1-runtime-contract.md`: exact implemented runtime contract.
- `docs/architecture/full-platform-target.md`: the next product-level generalization, clearly separated from what is already implemented.
- `docs/architecture/rejected-paths.md`: shortcuts and experiments that must not come back.
- `docs/powerfarm-v0.1-platform-proof.md`: dated historical Operate/Change/Sleep live proof.
- `state/migration-source.json`: canonical migration flags and source provenance.
- `state/legacy-production-baseline.json`: sealed historical production evidence used only for the one-time migration gate.
