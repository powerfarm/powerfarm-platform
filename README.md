# Powerfarm Platform

Canonical source for the Powerfarm platform.

This repository is a **rich canonical baseline**: the official Cloudflare OS upstream is pinned, while the reviewed Powerfarm v0.1 runtime layer lives here as first-class source. The legacy `OLD-*` repositories are provenance only.

## Foundation

- Cloudflare OS upstream: `cloudflare/cloudflare-os`
- pinned upstream commit: `bf7f762d7fa73553284d731ab6a978d3ea17be24`
- reviewed legacy Powerfarm provenance: `powerfarm/OLD-platform-NAO-USAR-os@350dc661bdd1c4d831e5eb1f6b9224a9050de88e`
- canonical runtime baseline commit: `570715a75ddf40288834e0249f37e77754034511`

## Runtime doctrine

```text
LLM designs it.
LLM operates it.
Registry remembers it.
Gatekeeper authorizes it.
ADK runs it.
LLM is none of those three.
```

And:

```text
Engine connects those facts without becoming another platform.
```

The implemented v0.1 spine is:

```text
Workspace typed capability
-> IdentityContext
-> Registry exact resolution
-> RunGrant
-> ExecutionEnvelope
-> private powerfarm-engine#WorkspaceRuntime
-> Google ADK
-> durable Supabase state
```

Only Identity brokers Engine. Engine invocation is non-public, Engine has no Supabase `service_role`, Gadget revisions are immutable/hash-addressed, and waiting ADK runs resume from durable state rather than process memory.

## Start here

- [`BASELINE.md`](BASELINE.md): canonical source, runtime, evidence and production-migration contract.
- [`docs/architecture/powerfarm-v0.1-runtime-contract.md`](docs/architecture/powerfarm-v0.1-runtime-contract.md): exact v0.1 authority and execution contract already present in source.
- [`docs/architecture/full-platform-target.md`](docs/architecture/full-platform-target.md): product-level generalization beyond the narrow v0.1 vertical slice.
- [`docs/architecture/rejected-paths.md`](docs/architecture/rejected-paths.md): shortcuts and experiments that must not return.
- [`docs/powerfarm-v0.1-platform-proof.md`](docs/powerfarm-v0.1-platform-proof.md): dated historical Operate/Change/Sleep live proof.

## Production safety

Canonical source and production authority are separate facts. The new repository must complete its read-only Cloudflare credential/topology preflight and one-time migration activation before it becomes the production deployment anchor. Continuous production deployment remains a later, separately reviewed step.

Cloudflare account ID comes from `deployment.jsonc`; workflows intentionally do not use a `CLOUDFLARE_ACCOUNT_ID` GitHub secret. Production token values must never be committed or printed.
