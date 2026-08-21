# ADK-JS on the Powerfarm Cloudflare runtime

Verified again 2026-08-20 against `@google/adk` 1.6.0, `@google/genai` 2.9.0,
Wrangler 4.118.0, workerd 1.20260730.1, compatibility date 2026-02-02,
`nodejs_compat`, and `nodejs_compat_do_not_populate_process_env`.

## Import spike

Three upstream package surfaces were exercised in the actual Worker toolchain:

1. `@google/adk` aggregate ESM bundled (about 10.6 MB raw / 1.929 MB gzip) but
   workerd failed at startup because an eagerly loaded Node dependency called
   `createRequire(import.meta.url)` with an undefined URL. Defining the URL then
   exposed a second eager Express/body-parser/iconv streams failure.
2. `@google/adk/dist/web/index_web.js` did not bundle: Wrangler reported
   `Unexpected "super"` in `dist/web/models/apigee_llm.js`.
3. Narrow upstream `dist/esm/...` imports, with
   `import.meta.url = "file:///worker/index.js"` at bundle time, loaded and ran.

The third path is isolated in `src/adk.ts`. It imports upstream implementation;
Powerfarm neither forks nor reimplements ADK. Each unpublished deep import is
immediately narrowed to the public ADK type. The exact dependency is lockfile
pinned and any upgrade must rerun this report.

## Runtime evidence

- `LlmAgent`, `SequentialAgent`, `Runner`, `BaseSessionService`, `BaseLlm`, and
  `BaseCodeExecutor` construct and execute in tests.
- A local Wrangler/workerd process served `/healthz` successfully.
- Production dry-run bundle: 3,389.53 KiB raw / 551.79 KiB gzip; no unusable
  Node-only dependency reached startup.
- The full repository deploy check bundled every existing Worker and the new
  Engine. Live settings confirm only Identity has
  `ENGINE → powerfarm-engine#WorkspaceRuntime`.
- The live Supabase test discarded the first client/runtime/Runner at
  `waiting_input`; a new set reloaded and completed the ADK invocation.
- The full live authority proof edited and published Registry revision 2,
  invoked its exact RunGrant, resumed through a fresh Engine service to
  `HELLO`, and returned one completed run row when its invocation key repeated.
- Engine version `fd3abaa1-989b-47d6-8fc3-0ebf049ea64a` is service-bound only;
  its former workers.dev URL now returns 404.

## Code-execution placement blocker

The canonical code-mode implementation is the existing private
`OverseerImpl.executeCodeMode()` path in pinned upstream
`cloudflare-os/packages/workshop-backend/src/overseer.ts`. It assembles a scoped
environment and delegates to `WorkerLoaderWorkerCode` with restricted outbound
access. It is not exposed by the public Overseer/service RPC surface.

Powerfarm OS forbids modifying the pinned upstream submodule. Therefore v0.1
ships and tests `PowerfarmCodeExecutor`, but the production Engine intentionally
does not bind it. A Gadget requesting execution is rejected during capability
resolution before model or external work. The unblock is an upstream-safe
callable seam for the existing method—not a second `env.LOADER` wrapper.

## Placement facts

- Workers AI is the explicit model capability and uses the Worker binding; no
  provider token enters the Gadget.
- The v0.1 Engine is a private service-binding placement. It is not blended
  into the public Router and no Engine binding exists on Router, Workshop,
  Custom Gatekeeper, or Gadget execution environments.
