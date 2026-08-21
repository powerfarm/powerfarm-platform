#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_COMMIT="b1d875034170379300e924e6fea2280852afee73"
TARGET_BRANCH="baseline/full-cloudflare-os-clean"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

rm -rf /tmp/pf-keep /tmp/cf-os
mkdir -p /tmp/pf-keep/packages /tmp/pf-keep/docs

for p in custom-gatekeeper error-reporter gatekeeper-identity powerfarm-engine; do
  test -d "packages/$p"
  cp -a "packages/$p" "/tmp/pf-keep/packages/$p"
done

test -d examples/gadgets/hello-agentic
mkdir -p /tmp/pf-keep/examples/gadgets
cp -a examples/gadgets/hello-agentic /tmp/pf-keep/examples/gadgets/

for p in docs/architecture docs/adr/0001-stateless-compute-durable-truth.md docs/adk-js-cloudflare-compatibility.md docs/powerfarm-v0.1-platform-proof.md; do
  if [[ -e "$p" ]]; then
    mkdir -p "/tmp/pf-keep/$(dirname "$p")"
    cp -a "$p" "/tmp/pf-keep/$p"
  fi
done

git clone --quiet https://github.com/cloudflare/cloudflare-os.git /tmp/cf-os
git -C /tmp/cf-os checkout --quiet "$UPSTREAM_COMMIT"
test "$(git -C /tmp/cf-os rev-parse HEAD)" = "$UPSTREAM_COMMIT"

# Replace the starter-shaped repository entirely. The current checkout's .git is the only thing
# retained. Cloudflare OS becomes the repository root, not a submodule and not a nested copy.
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
rsync -a --exclude=.git /tmp/cf-os/ ./
test -f packages/router/wrangler.jsonc
test -f packages/workshop-backend/wrangler.jsonc
test ! -e .gitmodules
test ! -e cloudflare-os

mkdir -p powerfarm
cp -a /tmp/pf-keep/packages/custom-gatekeeper powerfarm/custom-gatekeeper
cp -a /tmp/pf-keep/packages/error-reporter powerfarm/error-reporter
cp -a /tmp/pf-keep/packages/gatekeeper-identity powerfarm/gatekeeper-identity
cp -a /tmp/pf-keep/packages/powerfarm-engine powerfarm/engine

mkdir -p powerfarm/examples/gadgets
cp -a /tmp/pf-keep/examples/gadgets/hello-agentic powerfarm/examples/gadgets/

mkdir -p powerfarm/docs
if [[ -d /tmp/pf-keep/docs/architecture ]]; then cp -a /tmp/pf-keep/docs/architecture powerfarm/docs/; fi
if [[ -d /tmp/pf-keep/docs/adr ]]; then cp -a /tmp/pf-keep/docs/adr powerfarm/docs/; fi
for f in adk-js-cloudflare-compatibility.md powerfarm-v0.1-platform-proof.md; do
  if [[ -f "/tmp/pf-keep/docs/$f" ]]; then cp -a "/tmp/pf-keep/docs/$f" powerfarm/docs/; fi
done

# Do not carry generated wrapper outputs as Powerfarm source.
find powerfarm -type d \( -name dist -o -name .wrangler \) -prune -exec rm -rf {} +
find powerfarm -type f -name worker-configuration.d.ts -delete

# Moved extension packages now extend the full root directly.
sed -i 's#../../cloudflare-os/tsconfig.json#../../tsconfig.json#g' \
  powerfarm/custom-gatekeeper/tsconfig.json \
  powerfarm/error-reporter/tsconfig.json \
  powerfarm/gatekeeper-identity/tsconfig.json \
  powerfarm/engine/tsconfig.json
sed -i 's#"$schema": "node_modules/wrangler/config-schema.json"#"$schema": "../../node_modules/wrangler/config-schema.json"#' powerfarm/engine/wrangler.jsonc

node <<'NODE'
const fs = require('fs');
function replace(path, from, to) {
  const s = fs.readFileSync(path, 'utf8');
  if (!s.includes(from)) throw new Error(`${path}: expected ${from}`);
  fs.writeFileSync(path, s.replace(from, to));
}
replace('powerfarm/custom-gatekeeper/wrangler.jsonc', '"name": "custom-gatekeeper"', '"name": "powerfarm-gk-custom"');
replace('powerfarm/custom-gatekeeper/wrangler.jsonc', '"CUSTOM_NAME": "Example organization"', '"CUSTOM_NAME": "PowerFarm"');
replace('powerfarm/custom-gatekeeper/wrangler.jsonc', '"CUSTOM_MESSAGE": "Replace this with information useful to your organization."', '"CUSTOM_MESSAGE": "Regras e contexto do PowerFarm para agentes desta instancia."');
replace('powerfarm/error-reporter/wrangler.jsonc', '"name": "error-reporter"', '"name": "powerfarm-error-reporter"');
replace('powerfarm/engine/wrangler.jsonc', 'https://replace-from-deployment-config.supabase.co', 'https://wmsrqefgdgcijupeogfa.supabase.co');
NODE

sed -i '/^  - packages\/\*$/a\  - powerfarm/*' pnpm-workspace.yaml
cat >> .gitignore <<'EOF'

# Powerfarm extension generated artifacts are never source.
powerfarm/**/worker-configuration.d.ts
EOF

cat > powerfarm/source.json <<EOF
{
  "canonicalBase": {
    "repository": "cloudflare/cloudflare-os",
    "commit": "$UPSTREAM_COMMIT",
    "layout": "full-repository-root",
    "expectedCoreDeployableWorkers": 18
  },
  "legacyProvenance": {
    "repository": "powerfarm/OLD-platform-NAO-USAR-os",
    "role": "backup-and-provenance-only"
  },
  "starterIsBase": false,
  "reuseExistingCloudflareWorkers": false
}
EOF

core_count="$(find packages -mindepth 2 -maxdepth 2 -name wrangler.jsonc | wc -l | tr -d ' ')"
ext_count="$(find powerfarm -mindepth 2 -maxdepth 2 -name wrangler.jsonc | wc -l | tr -d ' ')"
test "$core_count" = "18"
test "$ext_count" = "4"
test ! -e state/ultimo-deploy.json

printf 'full Cloudflare OS core workers: %s\n' "$core_count"
printf 'Powerfarm extension workers: %s\n' "$ext_count"

git config user.name "powerfarm-baseline-bot"
git config user.email "powerfarm-baseline-bot@users.noreply.github.com"
git add -A
git status --short
git commit -m "refactor: base Powerfarm on full 18-worker Cloudflare OS"
# This branch exists only as a generated candidate tree. Replace it atomically, but refuse to
# clobber an unseen concurrent update.
git push --force-with-lease origin "HEAD:$TARGET_BRANCH"
