# PowerFarm custom Gatekeeper

This is the credential-free, read-only PowerFarm Gatekeeper for deployment-owned organization-specific capabilities. It exposes deployment information through a typed singleton and records every read as an observation.

It lives under `powerfarm/` because the repository root is the complete Cloudflare OS source tree. It is not copied from or deployed through `cloudflare-os-starter`.

## Adapt it

Change only the pieces the integration needs:

- `src/types.d.ts`: define the API agents and Gadgets may call.
- `src/types-code.ts`: keep the agent-facing declaration synchronized with `types.d.ts`.
- `src/custom.ts`: implement the real read operation and its observation description.
- `src/custom.ts`: keep vendor, account, resource, and binding metadata PowerFarm-specific.
- `wrangler.jsonc`: add non-secret bindings/variables and a migration when adding Durable Object classes.
- `../deployment.jsonc`: keep clean-install and topology invariants explicit.

Put API tokens and OAuth credentials in Wrangler secrets, never in `wrangler.jsonc` or versioned deployment configuration.

## Observer policy

`CustomVerifier.verify()` currently accepts every observer because the implementation returns the same low-stakes deployment text to every authenticated user. That is not a safe default for account-specific, tenant-specific, or confidential data.

A real integration must decide which observers may retain data and implement verification at that data boundary. The complete upstream repository includes `.agents/skills/write-gatekeeper/SKILL.md` for Gatekeeper design guidance.

## Check

```sh
pnpm test
pnpm run types:check
pnpm exec wrangler deploy --dry-run
```
