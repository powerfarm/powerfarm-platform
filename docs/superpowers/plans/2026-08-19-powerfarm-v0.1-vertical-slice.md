# Powerfarm v0.1 Vertical Slice Implementation Plan

> **Execution:** Follow `superpowers:executing-plans` and strict red-green-refactor TDD. The two clean repositories are already isolated on `codex/powerfarm-v0.1`; do not edit the user's dirty clones under `/Users/ubl-ops/dev/powerfarm-os` or `/Users/ubl-ops/dev/powerfarm-registry`.

**Goal:** Prove one real Gadget-owned ADK-JS invocation can validate, compile, run, persist into Supabase, lose its Worker isolate, resume later, and suppress a repeated capability effect.

**Topology:** Add one Powerfarm-owned Cloudflare Worker package, `powerfarm-engine`, beside (not inside) the pinned `cloudflare-os` submodule. It is a disposable HTTP/RPC compute placement, authenticates a Supabase bearer, reads a bundled Gadget YAML, runs `@google/adk@1.6.0`, and persists through user-JWT/RLS RPC functions into the Registry database. The existing public Router, Workshop Durable Objects, Identity gatekeeper, and Gatekeepers remain unchanged. The Engine receives Workers AI and optional code execution as explicit capabilities; neither Gadget YAML nor ADK session state receives credentials.

**Observed constraints that shape the implementation:**

- `@google/adk@1.6.0` aggregate Node ESM bundles with Wrangler 4.118.0 but crashes in workerd (`createRequire(import.meta.url)` receives `undefined`); its shipped web bundle fails to parse in Wrangler (`Unexpected super`). Narrow ESM imports plus a bundle-time `import.meta.url` definition run successfully under the exact pinned workerd.
- Registry migrations `0001`, `0002`, and `0003_authoridade` are live. `0003_authoridade.sql` is applied remotely but exists only as an untracked file in the user's original clone, so the clean source branch must restore those exact bytes before adding `0004`.
- The canonical Dynamic Worker path is private `OverseerImpl.executeCodeMode()` in pinned upstream. Powerfarm OS explicitly forbids patching upstream, and no current service/RPC boundary exposes that method. v0.1 may implement the ADK `BaseCodeExecutor` delegation boundary and tests, but production execution must remain unavailable until the existing path has an upstream-safe callable seam. It must not create a second `env.LOADER` path.

**Toolchain:** strict TypeScript 5.9; pnpm 11.9.0; Wrangler 4.118.0; Vitest 4.1.10; `@google/adk` 1.6.0 exact; JSON Schema Draft 2020-12 through Ajv; YAML through `yaml`; Supabase Auth/PostgREST through `@supabase/supabase-js` with `persistSession: false` and the caller's JWT.

---

## Task 1: Restore Registry migration source truth and specify ADK durability

**Files:**

- Add exact existing migration: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-registry/supabase/migrations/0003_autoridade.sql`
- Add migration: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-registry/supabase/migrations/0004_adk_runtime.sql`
- Add test: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-registry/tests/migrations.test.mjs`
- Modify: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-registry/package.json`

1. Write a failing migration contract test that requires migrations `0001` through `0004`, one `adk` schema, RLS on every ADK table, no service-role grants, and public RPC boundaries for session/event/checkpoint/effect operations.
2. Copy the exact already-applied `0003_autoridade.sql` content using `apply_patch`; do not reinterpret it.
3. Add `0004_adk_runtime.sql` in one file. Keep the already-live `public.runs` table and extend it with Gadget/version/definition/idempotency metadata and the statuses `created`, `running`, `waiting_input`, `completed`, `failed`, `cancelled`. Create `adk.sessions`, `adk.events`, `adk.checkpoints`, and `adk.effects` with stable keys, ownership, timestamps, JSON constraints, RLS, and indexes.
4. Add narrowly-scoped `public.powerfarm_*` SQL RPC functions so PostgREST can access the non-exposed `adk` schema. Session event append must atomically insert/deduplicate the event and update session state/time. Effect claim must atomically distinguish `claimed`, `completed`, and `uncertain`; a completed key returns the stored result and a non-terminal in-flight key is never executed twice.
5. Run `npm test` and `npm run build` with non-secret placeholder public Supabase values.

## Task 2: Create Gadget v0.1 contract, parser, normalizer, and deterministic compiler

**Files:**

- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/package.json`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/tsconfig.json`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/vitest.config.ts`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/contracts/gadget.schema.json`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/contracts/gadget.ts`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/contracts/gadget.test.ts`

1. Add failing tests for valid YAML, invalid schema, duplicate YAML keys, unknown fields, missing capabilities, invalid flow references, secret-shaped fields, stable normalization, and identical SHA-256 definition hashes across equivalent YAML ordering.
2. Define the smallest Draft 2020-12 schema: `apiVersion`, `kind`, `metadata.id/version`, `spec.agentic.runtime`, named agents, named flows with agent sequence, and named capabilities of `model`, `gatekeeper`, `input`, or `code-executor` kind.
3. Parse YAML without executing tags, validate schema strictly with Ajv 2020, normalize maps/lists/defaults, perform semantic reference validation, and canonicalize JSON for a stable definition hash.
4. Compile only `adk-js` to a provider-neutral execution plan. Reject unknown placements/capabilities before any model or external call.

## Task 3: Pin and isolate the working ADK-JS import surface

**Files:**

- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/adk.ts`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/adk.test.ts`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/wrangler.jsonc`
- Generate: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/worker-configuration.d.ts`
- Modify lockfile: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/pnpm-lock.yaml`

1. Pin `@google/adk` exactly to `1.6.0` and add only the direct supporting dependencies required by the package.
2. Add a failing runtime-surface test that constructs `LlmAgent`, `SequentialAgent`, `Runner`, `BaseSessionService`, `BaseLlm`, and `BaseCodeExecutor` through one local shim.
3. Export runtime values from the exact narrow `dist/esm/...` paths proven by the spike, and public package types as type-only imports. Do not fork or copy ADK implementation.
4. Configure the existing pinned compatibility date, `nodejs_compat`, `nodejs_compat_do_not_populate_process_env`, and the tested bundle-time `import.meta.url` definition. Generate Worker types with Wrangler.
5. Add a workerd test and `wrangler deploy --dry-run` assertion. Record bundle sizes and both failed aggregate strategies for the compatibility report.

## Task 4: Implement capability boundaries and the ADK compiler

**Files:**

- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/runtime/capabilities.ts`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/runtime/model.ts`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/runtime/code-executor.ts`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/runtime/compile-adk.ts`
- Add tests beside each module.

1. Write failing tests proving missing capability denial occurs before an effect, the model receives only a typed model capability, and no environment/credential object crosses into the agent definition.
2. Implement `PowerfarmModel extends BaseLlm`, delegating `LlmRequest` to an explicit `ModelCapability` and yielding the returned ADK response.
3. Implement `PowerfarmCodeExecutor extends BaseCodeExecutor`, delegating JavaScript/TypeScript only to an injected `CodeExecutionCapability`. Reject Python/shell and absent execution capability. Do not touch `env.LOADER`.
4. Compile each Gadget agent to `LlmAgent`, attach ADK's `requestInputTool` only when the explicit input capability is present, attach the code executor only when an existing-code-mode capability is present, and compile multi-step flows to `SequentialAgent`.
5. Add a `PlacementResolver` with only `cloudflare-adk-js`; provider details never enter the Gadget plan.

## Task 5: Implement Supabase-backed ADK session and run stores

**Files:**

- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/runtime/supabase.ts`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/runtime/session-service.ts`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/runtime/run-store.ts`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/runtime/effect-store.ts`
- Add unit tests with a stateful fake PostgREST boundary.

1. Write failing `BaseSessionService` conformance tests for create/get/list/delete/append, event deduplication, state persistence, and a second service instance reloading the same session.
2. Implement a Supabase client factory per invocation. It accepts only URL, publishable key, and caller bearer; disables session persistence/refresh; validates the bearer with `getClaims`; and never logs or returns it.
3. Implement the session service against the migration's public RPC functions. Call `super.appendEvent` for ADK semantics, then atomically persist the resulting event/state.
4. Implement run transitions with compare-and-set expectations and append a checkpoint for each accepted transition.
5. Implement effect claim/complete/uncertain. A request hash mismatch for a reused idempotency key is a conflict; an already-completed claim returns the prior result.

## Task 6: Implement invocation, wait, resume, and exactly-once demonstration

**Files:**

- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/runtime/invocation.ts`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/runtime/invocation.test.ts`

1. Start with failing state-machine tests: `CREATED -> RUNNING -> COMPLETED`, `RUNNING -> WAITING_INPUT`, a fresh runtime instance loading `WAITING_INPUT -> RUNNING -> COMPLETED`, duplicate invocation/effect idempotency, and failure/uncertain handling.
2. On invoke, load and compile the bundled Gadget, resolve explicit capabilities, create/get the ADK session and run, transition to running, execute Runner, and persist each ADK event through the custom session service.
3. Detect ADK long-running `adk_request_input` calls, persist the call id/message/schema, and return `waiting_input` without retaining a process.
4. On resume, reload the run/session, construct the ADK `functionResponse` using the persisted call id, run with resumability enabled, and commit completion.
5. Ensure all responses contain stable logical IDs and provenance but never bearer/provider credentials or raw env.

## Task 7: Add HTTP Worker, bundled Gadget, CLI, and Workers AI adapter

**Files:**

- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/index.ts`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/src/index.test.ts`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/examples/gadgets/hello-agentic/gadget.yaml`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/scripts/invoke.mjs`

1. Write failing handler tests for authentication, content type/size, unknown Gadget, invoke, get run, resume, idempotency header, malformed input, and sanitized errors.
2. Bundle the actual YAML as a Wrangler text module and expose:
   - `POST /v1/gadgets/:id/invocations`
   - `GET /v1/runs/:id`
   - `POST /v1/runs/:id/resume`
   - `GET /healthz`
3. Implement the Workers AI model adapter as the explicit `model` capability. Translate ADK messages/tools to the bound Workers AI surface; no API token is supplied to Gadget or ADK state.
4. Keep code execution absent unless a future `WorkshopCodeModeCapability` binding exists. A Gadget that requires execution receives a deterministic unavailable-capability error before model invocation.
5. Add a CLI that reads endpoint/token/input from environment/arguments without printing the token.

## Task 8: Integrate the disposable Engine into Powerfarm deployment topology

**Files:**

- Modify: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/deployment.jsonc`
- Modify: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/scripts/deploy-powerfarm.mjs`
- Modify: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/scripts/deploy.test.mjs`
- Modify: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/scripts/guards/check-platform-contract.mjs`
- Modify: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/scripts/lib.mjs`

1. Add failing deploy-generation tests requiring an independently deployable `powerfarm-engine` Worker, Workers AI binding, no Durable Object/D1 bindings, no provider secrets in vars, and no change to Router/Workshop/Gatekeeper bindings.
2. Add engine to the leaf deployment order. Give v0.1 an explicit Workers dev endpoint rather than silently blending it into the existing Router. Do not claim a production domain decision.
3. Supply public Supabase URL and engine configuration as vars; declare the publishable key as a required Worker secret/configured deployment input even though it is low privilege. Never include caller tokens or model secrets.
4. Extend guards and expected-state derivation so repository configuration remains deploy source of truth.

## Task 9: Apply and prove the live Supabase path

**Files:**

- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/test/live-supabase.test.ts`
- Use exact migration file from the Registry branch.

1. Validate the migration SQL locally through tests and inspect the current remote migration list.
2. Apply `0004_adk_runtime.sql` from source control to project `wmsrqefgdgcijupeogfa` using the Supabase migration API. This is an authorized, forward-only change; never use the dashboard.
3. Generate/compare database types or inspect the resulting tables/RLS/advisors.
4. Obtain a short-lived user JWT only at test runtime from the user-authorized `/Users/ubl-ops/Desktop/.env4` source or an authenticated Supabase flow. Do not print, copy, log, commit, or retain credentials.
5. Run the real persistence test: invoke, observe waiting/completed state, destroy the runtime object/process, instantiate again, reload and resume, reuse the idempotency key, and verify one effect row/result.

## Task 10: Documentation, compatibility evidence, and final verification

**Files:**

- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/docs/adr/0001-stateless-compute-durable-truth.md`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/docs/adk-js-cloudflare-compatibility.md`
- Add: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/packages/powerfarm-engine/README.md`
- Modify: `/Users/ubl-ops/dev/powerfarm-v0.1/powerfarm-os/README.md`

1. Write the requested ADR exactly around durable Supabase truth, disposable compute, logical `pf.engine`, Gadget-owned agent definitions, ADK-JS, capabilities, existing Dynamic Worker isolation, and stateless MCP role.
2. Write the compatibility report with exact versions, the two concrete failed import strategies, the working narrow ESM strategy, bundle/runtime proof, and the precise existing-code-mode seam blocker.
3. Document local/live invocation and resume commands, required non-secret vars/secrets, expected state transitions, and security invariants.
4. Run fresh verification:
   - Registry migration tests, TypeScript, and Next build.
   - Engine unit/integration/workerd tests, strict TypeScript, generated Worker types, and Wrangler dry run.
   - Powerfarm wrapper tests/guards/check.
   - Pinned upstream Cloudflare OS build and Workshop test suite.
   - Live Supabase resume/idempotency proof if credentials remain usable.
5. Inspect `git diff --check`, both repository statuses, secret scans, bundle contents for unusable Node imports, and verify no `.env`, token, provider key, or generated runtime state is tracked.
6. Use `superpowers:verification-before-completion`, then `superpowers:finishing-a-development-branch`; report exact verified claims and exact remaining blockers only.

