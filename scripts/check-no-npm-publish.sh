#!/usr/bin/env bash
set -euo pipefail

if grep -rnE 'NPM_TOKEN|NODE_AUTH_TOKEN|npm publish|yarn release' .github; then
  echo "::error::A workflow publishes to npm. The fork ships GitHub release tarballs only."
  exit 1
fi
