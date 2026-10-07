#!/usr/bin/env bash
set -euo pipefail

cd "${1:-.}"

all=() github=() workflows=() not_publisher=()
while IFS= read -r -d '' file; do
  file=${file#./}
  case "$file" in
    *.test.* | scripts/check-no-npm-publish.sh) continue ;;
  esac
  all+=("$file")
  case "$file" in
    .github/*) github+=("$file") ;;
  esac
  case "$file" in
    .github/workflows/semver-release.yml) ;;
    .github/workflows/*.yml | .github/workflows/*.yaml) workflows+=("$file") ;;
  esac
  [ "$file" = scripts/semver/publish.js ] || not_publisher+=("$file")
done < <(
  find . \( -name node_modules -o -name .git \) -prune -o -type f \
    \( -path './.github/*' -o -path './scripts/*' -o -name package.json \
    -o -name .npmrc -o -name '.yarnrc*' \) -print0
)

violations=0
check() {
  local rule=$1 pattern=$2 hits status=0
  shift 2
  [ "$#" -gt 0 ] || return 0
  hits=$(grep -nHE -- "$pattern" "$@") || status=$?
  if [ "$status" -gt 1 ]; then
    echo "::error::grep failed while checking $rule"
    exit 2
  fi
  [ -n "$hits" ] || return 0
  while IFS= read -r hit; do
    echo "$(cut -d: -f1,2 <<< "$hit") $rule"
    violations=$((violations + 1))
  done <<< "$hits"
}

check R1 'registry\.npmjs\.org|registry\.yarnpkg\.com' "${all[@]}"
check R2 'NPM_TOKEN|NODE_AUTH_TOKEN|registry-url' "${github[@]}"
check R3 "(npm|yarn|pnpm)[[:space:]]+publish|yarn[[:space:]]+release|[\"'\`]publish[\"'\`]" "${not_publisher[@]}"
check R4 'packages:[[:space:]]*write' "${workflows[@]}"

if [ "$violations" -gt 0 ]; then
  echo "::error::$violations line(s) could publish outside scripts/semver/publish.js or reach npmjs. R1: npmjs or yarnpkg registry URL. R2: npm token or registry-url in .github. R3: a publish command outside scripts/semver/publish.js. R4: packages: write outside semver-release.yml."
  exit 1
fi
