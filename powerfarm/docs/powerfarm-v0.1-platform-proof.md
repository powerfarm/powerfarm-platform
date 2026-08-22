# Powerfarm v0.1 platform proof

Verified 2026-08-20. This report distinguishes deterministic tests, live
Supabase evidence, live Cloudflare topology, and the remaining human OAuth step.

## Operate

The implemented path is:

`PowerfarmSession.helloRun → IdentityContext → installed hello.run resolution → exact RunGrant → ExecutionEnvelope → private WorkspaceRuntime → ADK-JS → Supabase`

The live proof completed run `7c41c5ea-a3d5-458d-b8a5-7578fed0b010`
with result `HELLO`. RunGrant `daba13c6-a577-49e0-a2e9-37f2bc691ed7`
pinned capability `hello.run`, authority version 1, revision 2, source hash
`dd6eb2e8165caf48a1a9d2b3f6fe5750a6df958a62ef9dbbfadc3f73f6f386ae`,
and definition hash
`3cb602a7c958911b9392592bc67b3705a4acf53c75a2267cac193b1442a8cf0f`.
The run row contains the same definition hash.

Repeating the invocation idempotency key returned that completed run. The
database contains exactly one run row for the key.

## Change

The Workspace capability and Registry Platform page both read
`powerfarm_gadget_get_draft`. Both write through the same optimistic
`powerfarm_gadget_apply_patch(gadget_id, base_revision, patch,
client_operation_id)` contract; stale bases raise `revision_conflict`.

The live proof changed the canonical draft to version 0.1.1, read the same
source back, validated it through the private Engine, and published immutable
revision 2. The next invocation provenance and RunGrant both named revision 2
and its exact hashes.

Registry UI preview:
`https://powerfarm-registry-mk3rn3kbc-carbonlab.vercel.app/gadgets/hello-agentic`
(authentication required).

## Sleep

The durable checkpoint sequence was:

`created → running → waiting_input → running → completed`

The run has 5 checkpoints and its ADK session has 4 durable events. Resume used
a newly constructed Engine service, database client, invocation runtime, ADK
Runner, and capability bindings. No process-memory object crossed the pause.

## Live topology and secrets

- Engine Cloudflare version: `fd3abaa1-989b-47d6-8fc3-0ebf049ea64a`.
- Identity Cloudflare version after connectable-resource fix:
  `a70ed8e6-8566-412d-bada-001ac54338b1`.
- Only Identity has `ENGINE → powerfarm-engine#WorkspaceRuntime`.
- Router, Workshop, and Custom Gatekeeper have no Engine binding.
- Engine bindings are AI, Supabase URL, Workers AI model name, and the
  publishable Supabase key secret.
- No service-role credential is present in the Engine.
- The former public Engine workers.dev URL returns 404; HTTP invocation is
  closed.
- Bearer and credential values are absent from envelope/result assertions and
  are never logged by the proof.
- A separately authenticated Powerfarm identity saw zero rows for the proof
  run. A direct authenticated insert into `runs` was denied with PostgreSQL
  `42501`; runtime writes remain behind the compare-and-set RPC boundary.

The live Gatekeepers UI now advertises `PowerFarm Identity` and its typed
`Powerfarm Workspace` capability. Connecting the current password-authenticated
platform user through OAuth is intentionally a human-approved action; after it
is approved, a new conversation receives the `PowerfarmSession` methods.

## Verification counts

- OS deterministic suite: 64 passed, 2 live-only skipped after the new resource
  test is included.
- Registry deterministic suite: 5 passed.
- Full live Operate/Change/Sleep test: 1 passed.
- Registry production build and Vercel preview build: passed.
- Full eight-Worker Wrangler dry-run: passed. Only Engine and Identity were
  deployed; no other Powerfarm service was redeployed.

## Deliberate blocker

`PowerfarmCodeExecutor` remains production-disabled. The pinned upstream
`OverseerImpl.executeCodeMode()` / `WorkerLoaderWorkerCode` path has the desired
isolation properties but no safe scoped RPC seam. Powerfarm does not add a
second `env.LOADER` wrapper or place arbitrary code in the privileged Engine.
