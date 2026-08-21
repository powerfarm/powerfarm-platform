# Powerfarm v0.1 runtime

This package is the thin, disposable execution end of the full Powerfarm path:

`typed Workspace capability → IdentityContext → exact Registry resolution → RunGrant → ExecutionEnvelope → ADK-JS → Supabase truth → disposable compute → resume`

The Registry owns mutable draft and immutable revision source. The Engine accepts
only a strict Registry-produced envelope; it does not own bundled Gadget YAML or
accept arbitrary source from the caller.

## Local verification

From the Powerfarm OS root:

```sh
pnpm --filter @powerfarm/engine test
pnpm --filter @powerfarm/engine build
pnpm --filter @powerfarm/engine types
pnpm --filter @powerfarm/engine exec wrangler deploy --dry-run
```

The credentialed integration test reads the user-authorized credential file at
runtime, never prints its values, creates and removes a temporary Auth caller,
and leaves the durable run provenance:

```sh
pnpm --filter @powerfarm/engine test:live
pnpm --filter @powerfarm/engine test:full-live
```

Override the local credential path with `POWERFARM_CREDENTIAL_FILE`.

`test:full-live` additionally exercises the real Registry authority path and
asserts edit/read/publish, exact revision pinning, `WAITING_INPUT`, a fresh
runtime resume, `COMPLETED → HELLO`, and completed-run idempotency replay.

## Private invocation

The Worker requires `SUPABASE_URL`, the `SUPABASE_PUBLISHABLE_KEY` Worker
secret, a Workers AI `AI` binding, and `WORKERS_AI_MODEL`. It exports the named
service entrypoint `WorkspaceRuntime`:

- `validateGadget(source)` for publication validation;
- `invokeGadget(executionEnvelope, delegatedBearer)`;
- `resumeRun(resumeEnvelope, delegatedBearer)`.

Only `powerfarm-gk-identity` receives that binding. Router, Workshop, Custom
Gatekeeper, and Gadgets do not. Production `workers_dev` is disabled; the
default HTTP handler is diagnostics-only and has no invocation route.

## Security invariants

- Supabase receives the caller bearer and enforces ownership through RLS/RPC.
- No service-role key exists in the Worker.
- The delegated bearer is used only to construct a caller-scoped database
  client; it is absent from envelopes, runs, sessions, events, results, and logs.
- Gadget revision, source hash, compiled definition hash, capability, and
  authority version are pinned before the Engine is called.
- The Workers AI binding is capability authority; no model credential is
  persisted or passed into ADK.
- A missing capability fails compilation before invocation.
- Effect completion is replayable; `claimed`/`uncertain` effects are not retried
  automatically.
- The Engine has no D1, Durable Object, service, or Worker Loader binding.

## Concrete TODO

- Expose the existing Workshop `executeCodeMode()` through an upstream-safe
  scoped RPC seam before enabling the production code-executor capability.
- Replace the narrow unpublished ADK ESM imports if Google publishes a Worker-
  safe documented export surface, after rerunning compatibility tests.
