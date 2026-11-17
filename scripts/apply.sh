#!/usr/bin/env bash
# Puts the extension host into a layerling checkout: copies the new files and applies the small hook patch.
# Usage: scripts/apply.sh [path-to-layerling]   (default: ./core)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="$(cd "${1:-$ROOT/core}" && pwd)"
PATCH="$ROOT/patches/extension-hooks.patch"

cd "$CORE"
[ -f apps/web/src/components/LayerlingEditor.tsx ] || { echo "Not a layerling checkout: $CORE" >&2; exit 1; }

# New files only: they never conflict with layerling's own.
cp -R "$ROOT/overlay/." "$CORE/"

if git apply --check "$PATCH" 2>/dev/null; then
  git apply "$PATCH"
elif git apply --reverse --check "$PATCH" 2>/dev/null; then
  echo "Hooks already applied."
elif git apply --3way "$PATCH"; then
  echo "Hooks applied with a 3-way merge (layerling moved some lines)."
else
  cat >&2 <<EOF

The hook patch no longer fits this layerling version.
Conflicts are marked in the files above. Each hook is one or two lines (see README "Hook points");
fix them in $CORE, then refresh the patch:

  cd "$CORE" && git diff > "$PATCH"

EOF
  exit 1
fi

echo "Extension host applied to $CORE ($(git describe --tags --always 2>/dev/null || echo unknown))."
