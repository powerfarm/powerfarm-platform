# Rejected paths and replacement patterns

This file exists to keep old failure modes from quietly returning during future refactors. These are not style preferences. Each item protects a boundary that was already learned the hard way.

| Rejected path | Why it is wrong | Replacement |
| --- | --- | --- |
| `cloudflare-os-starter` as the Powerfarm canonical base | The starter is deployment scaffolding, not the complete OS source/topology the platform is built from | Keep the complete pinned `cloudflare/cloudflare-os` repository at the canonical repository root |
| Full Cloudflare OS hidden behind a git submodule/wrapper | Makes the wrapper look like the platform and lets tooling/LLMs reason from a partial tree | Full upstream source is the root tree; Powerfarm-specific extensions live under `powerfarm/` |
| Adopting an already-live old Worker because its bytes look equivalent | Preserves topology ambiguity and makes it impossible to prove which installation a component belongs to | Inventory old installation, delete it, prove absence, then create every replacement Worker from the canonical repo |
| Hybrid cutover such as old Router/Backend/Engine plus new Identity | Produces exactly the topology ambiguity the clean reinstall is meant to eliminate | Deletion precedes creation; no replacement Worker is created until the old Worker installation is gone |
| Public HTTP invocation of Engine | Exposes runtime as a generic network service and bypasses the intended authority chain | Private Cloudflare Service Binding to named `WorkspaceRuntime` entrypoint |
| `ENGINE` binding on Router | Makes the public edge an execution broker and collapses authority boundaries | Only Identity brokers Engine |
| `ENGINE` binding on Workshop/backend | Lets the general Workspace backend become an implicit runtime authority | Workspace gets typed Gatekeeper capability; Identity delegates privately |
| `ENGINE` binding on Custom Gatekeeper or Gadgets | Expands runtime authority to unrelated actors | Narrow capability-specific Gatekeepers only |
| Workspace LLM calling Engine via `webFetch` / internal URL | Turns capability security into URL knowledge | Typed Powerfarm capability surface |
| LLM calling generic `invokeGadget(gadgetId, revision, source, ...)` | Lets the model nominate executable authority facts | Registry resolves installation, revision, source and grant; LLM sees narrow verbs |
| Trusting caller-supplied `workspaceId` as authority | Resource identifiers are not permissions | Resolve actor/workspace through authenticated Registry context and RLS |
| Caller-supplied arbitrary Gadget YAML at invocation time | Bypasses Registry lineage and publication | Execute exact source from immutable resolved revision inside `ExecutionEnvelope` |
| Bundled Engine-owned canonical Gadget source | Creates split-brain source truth between UI/Registry and Engine | Registry owns draft + immutable published revisions; Engine only validates/executes resolved source |
| Blind full-file overwrite for LLM/UI edits | Loses concurrent edits | `base_revision` + patch + compare-and-set + `revision_conflict` |
| Mutable published Gadget revision | Breaks reproducibility and audit | Immutable revision + source/definition hashes |
| Supabase `service_role` in Engine | Quietly bypasses user/RLS containment and gives runtime excessive privilege | Publishable key + delegated user JWT for interactive paths; narrow privileged boundary only when explicitly designed |
| Persisting human access/refresh token in run or ADK state | Credential leakage and unsafe long-running authority | Fresh token only at interactive edge; durable `RunGrant` for run authority |
| Identity treated as final authority | Authentication and authorization collapse into one component | Identity proves actor, Registry resolves world, Gatekeeper authorizes exact capability |
| Gatekeeper approval encoded as ADK HITL prompt | Workflow logic can blur or bypass security semantics | Separate ADK HITL, Gatekeeper approval, Registry governance |
| Reimplementing ADK graph/state-machine semantics in Powerfarm | Creates two workflow engines with divergent replay/resume rules | ADK owns workflow semantics; Powerfarm wraps it with control-plane concerns |
| Arbitrary privileged code execution inside Engine | Makes Engine a high-privilege sandbox escape target | Keep `PowerfarmCodeExecutor` production-disabled until a scoped upstream isolation seam exists |
| Second ad-hoc `env.LOADER` wrapper | Duplicates an unproven privileged execution boundary | Use the pinned upstream mechanism only after a safe scoped RPC seam is proved |
| Engine holding Worker/service internal URLs for invocation | Couples runtime to routing and makes public reachability tempting | Service Binding RPC |
| Powerfarm extension `dist/**` committed as canonical source | Imports stale build output and hides reproducibility problems | Rebuild Powerfarm extension output deterministically |
| Powerfarm extension `worker-configuration.d.ts` committed as source | Creates drift between Powerfarm Wrangler config and generated types | Generate Powerfarm extension Worker types from Wrangler config during build/CI. Do not delete files that are intentionally part of the pinned upstream source tree. |
| Depending on `OLD-*` repo at runtime/build/deploy | Keeps migration history alive as an operational dependency | Legacy repositories are provenance/read-only evidence only |
| Copying legacy `state/ultimo-deploy.json.commit` into the new repo | The commit belongs to another Git history and cannot be a canonical anchor | Create a fresh deployment anchor only after the clean replacement installation passes live proof |
| Enabling continuous deploy before the clean reinstall | Lets canonical CI write into an account whose old topology has not been eliminated | Inventory -> backup/provenance proof -> delete old Worker installation -> prove absence -> install full base + Powerfarm extensions -> Operate/Change/Sleep -> fresh anchor -> later steady-state controller |
| Using `CLOUDFLARE_ACCOUNT_ID` secret as config truth | Duplicates a non-secret identifier and permits silent disagreement | Parse/validate `powerfarm/deployment.jsonc.accountId`; workflows intentionally ignore an account-ID secret |
| Treating old docs or recorded Worker IDs as current live state | Turns stale evidence into deployment decisions | Re-read authenticated live state before writes |

## A useful review question

For any new runtime feature, ask:

> Does this change let a caller choose an authority fact that should have been resolved before Engine execution?

If the answer is yes, the change probably belongs in Registry/Gatekeeper resolution rather than in Engine.

A second question catches credential shortcuts:

> Would this still be safe if the LLM, Gadget code, retry machinery, logs, and waiting run state were all inspected by an attacker?

If safety depends on a bearer token or broad secret remaining invisible inside those layers, the design is too privileged.

For deployment/topology changes, a third question is mandatory:

> Can every active Worker be proven to have been created from this canonical repository after the previous installation was removed?

If not, the platform is not yet a clean canonical installation.
