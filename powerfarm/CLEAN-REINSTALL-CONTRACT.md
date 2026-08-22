# Powerfarm clean reinstall contract

This file is an operational invariant, not a suggestion.

## 1. Canonical source is the full Cloudflare OS repository

The repository root is the complete `cloudflare/cloudflare-os` source tree pinned in `powerfarm/source.json`.

It is **not**:

- `cloudflare-os-starter`;
- a starter wrapper around Cloudflare OS;
- Cloudflare OS mounted as a git submodule;
- a hand-selected subset of upstream packages;
- the topology that happens to be live in the Cloudflare account.

At the current pin, the upstream source contains exactly **18 deployable core Worker packages**: 16 Gatekeepers, Router, and Workshop Backend. Powerfarm-specific runtime extensions live under `powerfarm/` on top of that complete source tree.

If upstream later contains 19, 22, 30, or another number of deployable Workers, update the pin and the topology guard intentionally. Never infer the canonical topology from Cloudflare account residue.

## 2. OLD repositories are backup and provenance only

`powerfarm/OLD-platform-NAO-USAR-os` and other `OLD-*` repositories may be used to recover reviewed Powerfarm code, architecture evidence, and historical behavior.

They are not runtime, build, deployment, or topology dependencies of the new platform.

Known-good code may be copied. Existing Worker deployments are not adopted.

## 3. Cloudflare reset rule

**Deletion precedes creation.**

Before any Worker belonging to the replacement Powerfarm installation is created, the existing Powerfarm Worker installation in Cloudflare must be inventoried, backed by Git provenance, removed, and proven absent.

A maintenance window is acceptable. A hybrid topology is not.

Forbidden end states include:

- old Router plus new Identity;
- old Backend plus new Gatekeepers;
- old Engine reused because its bytes appear equivalent;
- an Identity-only cutover described as a platform migration;
- retaining an old Worker merely to avoid recreating its bindings;
- treating old deployment/version IDs as the new canonical baseline.

Worker names may be reused only after the previous installation has been removed. Reusing a name is not reusing a deployment.

## 4. Required destructive sequence

The production replacement must follow this order:

1. Inventory all existing Powerfarm Worker scripts, deployment/version IDs, routes/custom domains, service bindings, Durable Object migrations/bindings, KV/R2/D1 resources, queues, AI bindings, and the names of required secrets. Never print secret values.
2. Record that inventory as historical evidence and confirm the OLD GitHub repositories remain available as code/provenance backup.
3. Classify durable data that is intentionally preserved independently of Worker compute. Preservation must be explicit, not accidental.
4. Detach public routing where necessary so the old Router cannot continue serving while replacement topology is being assembled.
5. Delete the old Powerfarm Worker installation from Cloudflare.
6. Prove the old Worker topology is absent before creating any replacement Worker.
7. Install the full 18-Worker Cloudflare OS core from this repository root.
8. Install the reviewed Powerfarm extension Workers from `powerfarm/`.
9. Create only the explicitly authorized service-binding edges.
10. Attach `powerfarm.app` only after the replacement Router and its dependencies are coherent.
11. Re-run live Operate, Change, Sleep, idempotency, and resume proofs.
12. Only then write a new deployment anchor and mark production baseline active.

There is no step that adopts a live old Worker into the new baseline.

## 5. Durable state is not Worker compute

Deleting the old Worker installation does not automatically mean deleting every durable data store.

Supabase/Registry data, required KV namespaces, R2 buckets, Durable Object storage, queues, D1 databases, and other durable resources must be classified during inventory. A durable resource is preserved only when the new architecture explicitly requires continuity of that data.

This distinction exists to prevent an infrastructure reset from silently becoming an irreversible data-loss operation. It does not permit preserving old Worker deployments.

## 6. Powerfarm runtime invariants

Identity proves **who**. Registry states **what world exists**. Gatekeeper decides **whether** the actor may perform the exact action. Engine executes **what was authorized**. ADK owns workflow execution semantics.

> LLM designs it. LLM operates it. Registry remembers it. Gatekeeper authorizes it. ADK runs it. LLM is none of those three.
>
> Engine connects those facts without becoming another platform.

The Powerfarm runtime must preserve these constraints:

- Registry resolves the exact installed capability and immutable Gadget revision.
- Gatekeeper issues the exact RunGrant/authority snapshot.
- Engine receives an ExecutionEnvelope and stays thin.
- Only Powerfarm Identity may broker the private `ENGINE -> powerfarm-engine#WorkspaceRuntime` binding.
- Engine remains non-public (`workers_dev = false`).
- Engine does not receive a Supabase service-role credential.
- A caller or Workspace LLM cannot supply arbitrary Gadget source, revision, workspace, grant, or authority material.
- `invokeGadget` remains a runtime primitive rather than generic LLM UX.
- ADK remains the workflow runtime. Powerfarm does not grow a second workflow graph over it.
- Published Gadget revisions remain immutable and drafts use optimistic revision control.

## 7. Live proof after replacement

### Operate

Prove the complete path against the replacement installation:

`Workspace -> typed capability -> IdentityContext -> Registry resolution -> RunGrant -> ExecutionEnvelope -> private WorkspaceRuntime -> ADK -> durable result`

Repeat an identical idempotency key and prove it resolves to the same completed run.

### Change

Prove draft read, optimistic patch, stale revision conflict, immutable publish, and a subsequent run pinned to the exact published revision/hash.

### Sleep

Prove:

`created -> running -> waiting_input -> running -> completed`

Resume must rebuild fresh Engine/runtime/ADK objects from durable state. No in-memory runtime object may be required to cross the pause.

## 8. Definition of done

A clean reinstall is complete only when all of the following are true:

- the repository root is the full pinned `cloudflare/cloudflare-os` source tree;
- the starter is not the base;
- there is no Cloudflare OS submodule wrapper;
- OLD repositories are provenance only;
- the old Worker installation was removed before replacement Worker creation;
- no old Worker deployment is part of the active topology;
- all replacement Workers were emitted from this repository after the reset;
- `powerfarm.app` reaches the replacement Router;
- the private binding topology is proven;
- Engine is private and has no service-role credential;
- Operate, Change, Sleep, idempotency, and resume pass live;
- a fresh deployment anchor records only the replacement installation.

Until every item above is true, `productionBaselineActivated` must not be asserted as true.
