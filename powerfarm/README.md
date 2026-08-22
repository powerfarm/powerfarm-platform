# Powerfarm layer

The repository root is the complete pinned `cloudflare/cloudflare-os` source tree. This directory contains only Powerfarm-specific runtime extensions, architecture evidence, and installation controls.

**The base is not `cloudflare-os-starter`.** It is not a starter wrapper and it is not a submodule.

Read `CLEAN-REINSTALL-CONTRACT.md` before any production operation. It deliberately forbids the previous hybrid migration pattern and requires the old Cloudflare Worker installation to be removed before replacement Workers are created.

## Source layout

- `../packages/*`: full Cloudflare OS source. At the current pin, 18 deployable core Workers.
- `gatekeeper-identity`: Powerfarm identity and Registry authority bridge. The only component allowed to bind to Engine.
- `engine`: private ADK execution runtime.
- `custom-gatekeeper`: Powerfarm organization-specific capability surface.
- `error-reporter`: private structured error sink.
- `examples/gadgets`: reviewed Powerfarm Gadget examples/proofs.
- `docs`: Powerfarm architecture and historical proof records.
- `source.json`: exact upstream provenance and base-shape contract.

OLD repositories remain backup/provenance only. Their Worker deployments are not a substrate for the replacement platform.
