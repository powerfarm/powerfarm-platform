#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REPOSITORY="cloudflare/cloudflare-os"
UPSTREAM_COMMIT="b1d875034170379300e924e6fea2280852afee73"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

rm -rf /tmp/powerfarm-overlay /tmp/cloudflare-os-upstream
mkdir -p /tmp/powerfarm-overlay

keep() {
  local src="$1"
  local dst="/tmp/powerfarm-overlay/$1"
  if [[ -e "$src" ]]; then
    mkdir -p "$(dirname "$dst")"
    cp -a "$src" "$dst"
  fi
}

# Keep only the reviewed Powerfarm implementation and architecture evidence.
keep packages/custom-gatekeeper
keep packages/error-reporter
keep packages/gatekeeper-identity
keep packages/powerfarm-engine
keep examples/gadgets/hello-agentic
keep docs/architecture
keep docs/adr/0001-stateless-compute-durable-truth.md
keep docs/adk-js-cloudflare-compatibility.md
keep docs/powerfarm-v0.1-platform-proof.md
keep docs/superpowers/plans/2026-08-19-powerfarm-v0.1-vertical-slice.md

git clone --quiet "https://github.com/${UPSTREAM_REPOSITORY}.git" /tmp/cloudflare-os-upstream
git -C /tmp/cloudflare-os-upstream checkout --quiet "$UPSTREAM_COMMIT"
test "$(git -C /tmp/cloudflare-os-upstream rev-parse HEAD)" = "$UPSTREAM_COMMIT"

# This is the key operation: the repository root becomes the FULL Cloudflare OS.
# The old starter-shaped wrapper, submodule, deployment state, and deploy scripts are not carried.
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
rsync -a --exclude=.git /tmp/cloudflare-os-upstream/ ./

test -f packages/router/wrangler.jsonc
test -f packages/workshop-backend/wrangler.jsonc
test ! -e .gitmodules
test ! -e cloudflare-os

mkdir -p powerfarm
cp -a /tmp/powerfarm-overlay/packages/custom-gatekeeper powerfarm/custom-gatekeeper
cp -a /tmp/powerfarm-overlay/packages/error-reporter powerfarm/error-reporter
cp -a /tmp/powerfarm-overlay/packages/gatekeeper-identity powerfarm/gatekeeper-identity
cp -a /tmp/powerfarm-overlay/packages/powerfarm-engine powerfarm/engine

mkdir -p powerfarm/examples/gadgets
cp -a /tmp/powerfarm-overlay/examples/gadgets/hello-agentic powerfarm/examples/gadgets/hello-agentic

mkdir -p powerfarm/docs
if [[ -d /tmp/powerfarm-overlay/docs/architecture ]]; then
  cp -a /tmp/powerfarm-overlay/docs/architecture powerfarm/docs/architecture
fi
if [[ -d /tmp/powerfarm-overlay/docs/adr ]]; then
  cp -a /tmp/powerfarm-overlay/docs/adr powerfarm/docs/adr
fi
for f in adk-js-cloudflare-compatibility.md powerfarm-v0.1-platform-proof.md; do
  if [[ -f "/tmp/powerfarm-overlay/docs/$f" ]]; then
    cp -a "/tmp/powerfarm-overlay/docs/$f" "powerfarm/docs/$f"
  fi
done
if [[ -f /tmp/powerfarm-overlay/docs/superpowers/plans/2026-08-19-powerfarm-v0.1-vertical-slice.md ]]; then
  mkdir -p powerfarm/docs/plans
  cp -a /tmp/powerfarm-overlay/docs/superpowers/plans/2026-08-19-powerfarm-v0.1-vertical-slice.md powerfarm/docs/plans/
fi

# Generated outputs from the old wrapper are not source for the Powerfarm layer.
find powerfarm -type d \( -name dist -o -name .wrangler \) -prune -exec rm -rf {} +
find powerfarm -type f -name worker-configuration.d.ts -delete

# Extensions now sit two levels below the full repository root.
sed -i 's#../../cloudflare-os/tsconfig.json#../../tsconfig.json#g' \
  powerfarm/custom-gatekeeper/tsconfig.json \
  powerfarm/error-reporter/tsconfig.json \
  powerfarm/gatekeeper-identity/tsconfig.json \
  powerfarm/engine/tsconfig.json
sed -i 's#"$schema": "node_modules/wrangler/config-schema.json"#"$schema": "../../node_modules/wrangler/config-schema.json"#' powerfarm/engine/wrangler.jsonc

node <<'NODE'
const fs = require('fs');
for (const path of ['powerfarm/custom-gatekeeper/package.json', 'powerfarm/gatekeeper-identity/package.json']) {
  const p = JSON.parse(fs.readFileSync(path, 'utf8'));
  p.dependencies.capnweb = 'catalog:';
  p.dependencies['capnweb-validate'] = 'catalog:';
  p.devDependencies.typescript = 'catalog:';
  p.devDependencies.vite = 'catalog:';
  p.devDependencies.vitest = 'catalog:';
  p.devDependencies.wrangler = 'catalog:';
  if (p.devDependencies['@cloudflare/vitest-pool-workers']) p.devDependencies['@cloudflare/vitest-pool-workers'] = 'catalog:';
  fs.writeFileSync(path, JSON.stringify(p, null, 2) + '\n');
}

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

mkdir -p powerfarm
cat > powerfarm/source.json <<EOF
{
  "canonicalBase": {
    "repository": "${UPSTREAM_REPOSITORY}",
    "commit": "${UPSTREAM_COMMIT}",
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

corepack enable
corepack prepare pnpm@11.17.0 --activate
pnpm install --lockfile-only --no-frozen-lockfile

# Structural proof before committing the imported tree.
count="$(find packages -mindepth 2 -maxdepth 2 -name wrangler.jsonc | wc -l | tr -d ' ')"
test "$count" = "18"
test "$(find powerfarm -mindepth 2 -maxdepth 2 -name wrangler.jsonc | wc -l | tr -d ' ')" = "4"
test ! -e state/ultimo-deploy.json

git add -A
git status --short
git commit -m "refactor: base Powerfarm on full 18-worker Cloudflare OS"
git push origin HEAD:baseline/full-cloudflare-os-clean
