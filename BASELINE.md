# Powerfarm canonical baseline

## Purpose

This repository is a clean canonical baseline for Powerfarm. It does not continue the Git history of `powerfarm/OLD-platform-NAO-USAR-os` and must not depend on that repository at runtime, build time, or deploy time.

## Upstream root

Cloudflare OS is consumed as the official upstream submodule:

- repository: `https://github.com/cloudflare/cloudflare-os.git`
- commit: `bf7f762d7fa73553284d731ab6a978d3ea17be24`

The upstream commit is pinned deliberately. Upstream upgrades must be explicit reviewed changes.

## Powerfarm provenance

The reviewed Powerfarm layer to be reapplied comes from the final legacy snapshot:

- legacy repository: `powerfarm/OLD-platform-NAO-USAR-os`
- reviewed snapshot: `350dc661bdd1c4d831e5eb1f6b9224a9050de88e`

That SHA is provenance, not a dependency. Files are reapplied into this repository as first-class Powerfarm source.

## Canonical separation

The baseline must preserve these boundaries:

1. `cloudflare-os/` is upstream Cloudflare OS, pinned as a gitlink.
2. Powerfarm Identity/Gatekeeper, Engine, deployment wrapper, guards, state schema, ADRs and platform proofs live in this repository.
3. Generated build artifacts are regenerated, not imported as historical baggage.
4. The legacy `OLD-*` repositories are read-only evidence after migration.

## Runtime invariants

- Identity is not authority; Gatekeeper authorization is explicit.
- Registry is durable truth and resolves the exact world before execution.
- Engine stays thin and receives a strict ExecutionEnvelope.
- Only Identity may broker the private `WorkspaceRuntime` binding to Engine.
- Engine remains non-public and contains no Supabase service-role credential.
- Gadget published revisions are immutable and hash-addressed.
- Operate, Change and Sleep loops are part of the v0.1 baseline contract.

Doctrine: `LLM designs it. LLM operates it. Registry remembers it. Gatekeeper authorizes it. ADK runs it. LLM is none of those three.`

## Deployment migration gate

This bootstrap must not become a production deploy source merely because files exist here. Before production deployment is enabled from this repository:

1. Reapply the reviewed Powerfarm source layer and deterministic tests.
2. Re-establish CI guards against the official upstream and platform contract.
3. Create a new deployment-state anchor whose commit belongs to this repository. Do not copy the legacy `state/ultimo-deploy.json.commit` verbatim because that SHA belongs to another Git history.
4. Configure valid Cloudflare account-owned deployment and read-only tokens in the new repository/environment without placing secret values in Git.
5. Run deterministic tests and full Wrangler dry-runs.
6. Verify the live topology before the first deployment from this repository.
7. Enable production deployment only after those gates are green.

Until all seven are satisfied, this repository is canonical source under construction, not an authorized production deploy controller.
