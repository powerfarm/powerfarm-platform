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

# Replace the starter-shaped repository entirely. Do not nest or submodule Cloudflare OS.
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a /tmp/cf-os/. .
rm -rf .git
# Restore the canonical repository's own git metadata, which stayed open in the checkout process.
# `cp -a /tmp/cf-os/. .` copied upstream .git, so remove it and reinitialize metadata from the
# checkout backup kept by actions/checkout.
