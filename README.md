# Powerfarm Platform

Canonical source for the Powerfarm platform.

## Baseline

The platform is built as a thin Powerfarm layer over the official Cloudflare OS upstream.

- Upstream: `cloudflare/cloudflare-os`
- Pinned baseline: `bf7f762d7fa73553284d731ab6a978d3ea17be24`
- Legacy repository: `powerfarm/OLD-platform-NAO-USAR-os` is provenance only, never a runtime or source dependency.

The bootstrap branch is intentionally non-deploying until the Powerfarm layer, state anchor, CI guards, and production credentials are re-established in this repository.

See `BASELINE.md` for the migration contract.
