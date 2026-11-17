#!/usr/bin/env bash
# Pulls the latest layerling, applies the extension host and rebuilds the container.
# Your extensions/ and extension-data/ folders are never touched.
#
#   scripts/update.sh                 latest main
#   LAYERLING_REF=v1.165.2 scripts/update.sh   a tag or commit
#   scripts/update.sh --no-build      only prepare ./core
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="$ROOT/core"
REPO="${LAYERLING_REPO:-https://github.com/henmedia/layerling.git}"
REF="${LAYERLING_REF:-main}"

if [ ! -d "$CORE/.git" ]; then
  git clone "$REPO" "$CORE"
fi

cd "$CORE"
git fetch --tags --force origin
# ./core is a build folder: throw away the previous hooks and start from a clean layerling.
git reset --hard -q
git clean -fdq
if git rev-parse -q --verify "origin/$REF" >/dev/null; then
  git checkout -q --detach "origin/$REF"
else
  git checkout -q --detach "$REF"
fi
echo "layerling $(node -p "require('./package.json').version" 2>/dev/null || git describe --tags --always)"

"$ROOT/scripts/apply.sh" "$CORE"

if [ "${1:-}" != "--no-build" ]; then
  cd "$ROOT"
  docker compose -f docker/compose.yml up -d --build
fi
