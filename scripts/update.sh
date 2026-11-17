#!/usr/bin/env bash
# Installs or updates layerling with the extension host, then builds and starts it.
#
#   scripts/update.sh                        install, or update to the latest layerling
#   scripts/update.sh --configure            ask for the designs folder and port again
#   LAYERLING_REF=v1.165.2 scripts/update.sh pin a layerling tag, branch or commit (remembered)
#   LAYERLING_REF=main scripts/update.sh     back to the latest
#   scripts/update.sh --no-build             prepare ./core only
#   scripts/update.sh --no-self-update       don't pull this repo first
#
# Your extensions/, extension-data/ and designs folder are never touched.
# The Updates button in layerling runs this same script (with --ui).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="$ROOT/core"
ENV_FILE="$ROOT/docker/.env"
REPO="${LAYERLING_REPO:-https://github.com/henmedia/layerling.git}"
COMPOSE=(docker compose -f "$ROOT/docker/compose.yml")

UI=0
BUILD=1
CONFIGURE=0
SELF_UPDATE=1
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --ui) UI=1 ;;
    --no-build) BUILD=0 ;;
    --configure) CONFIGURE=1 ;;
    --no-self-update | --self-updated) SELF_UPDATE=0 ;;
    -h | --help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
  [ "$arg" = "--self-updated" ] || ARGS+=("$arg")
done

# ---- Output: plain text for people, ::markers for the Updates window ---------------------------------------------

step() { [ "$UI" = 1 ] && echo "::step $1"; echo; echo "==> $2"; }
skip() { [ "$UI" = 1 ] && echo "::skip $1 $2"; echo "    $2"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

# ---- docker/.env ---------------------------------------------------------------------------------------------------

env_get() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true
}

env_set() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp="$(mktemp)"
  grep -vE "^$key=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
}

port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

first_free_port() {
  local port="$1"
  while port_in_use "$port"; do port=$((port + 1)); done
  echo "$port"
}

our_port() {
  # The port our own running container already holds counts as free for it.
  "${COMPOSE[@]}" port layerling 3000 2>/dev/null | sed -E 's/.*:([0-9]+)$/\1/' || true
}

absolute_dir() {
  local dir="$1"
  case "$dir" in "~") dir="$HOME" ;; "~/"*) dir="$HOME/${dir#\~/}" ;; esac
  case "$dir" in /*) ;; *) dir="$ROOT/$dir" ;; esac
  mkdir -p "$dir" || return 1
  (cd "$dir" && pwd)
}

configure() {
  local designs port default_designs default_port answer current
  default_designs="$(env_get LAYERLING_DESIGNS_DIR)"
  default_designs="${default_designs:-$HOME/Layerling}"
  current="$(our_port)"
  default_port="$(env_get LAYERLING_PORT)"
  if [ -z "$default_port" ] || { port_in_use "$default_port" && [ "$default_port" != "$current" ]; }; then
    default_port="$(first_free_port 3000)"
  fi

  echo
  echo "layerling setup"
  echo "  Your designs are saved as .lyl files in a folder on this computer: they survive updates and"
  echo "  can be backed up, synced or opened like any other files."
  echo
  while :; do
    read -r -p "  Folder for your designs [$default_designs]: " answer || true
    designs="$(absolute_dir "${answer:-$default_designs}")" && break
    echo "  Can't create that folder, try another."
  done
  while :; do
    read -r -p "  Port to open layerling on [$default_port]: " answer || true
    port="${answer:-$default_port}"
    case "$port" in *[!0-9]* | "") echo "  A number, please."; continue ;; esac
    if port_in_use "$port" && [ "$port" != "$current" ]; then
      echo "  Port $port is in use. $(first_free_port "$port") is free."
      continue
    fi
    break
  done
  env_set LAYERLING_DESIGNS_DIR "$designs"
  env_set LAYERLING_PORT "$port"
  echo
  echo "  Designs: $designs"
  echo "  Address: http://localhost:$port"
  if [ "$(uname)" = "Darwin" ]; then
    case "$designs" in /Users/* | /tmp/* | /private/* | /Volumes/*) ;; *)
      echo "  Note: add $designs to Docker Desktop > Settings > Resources > File sharing." ;;
    esac
  fi
}

ensure_env() {
  mkdir -p "$ROOT/docker"
  local interactive=0
  if [ "$UI" = 0 ] && [ -t 0 ] && { [ "$CONFIGURE" = 1 ] || [ -z "$(env_get LAYERLING_DESIGNS_DIR)" ]; }; then
    interactive=1
  fi
  if [ "$interactive" = 1 ]; then
    configure
  else
    if [ -z "$(env_get LAYERLING_DESIGNS_DIR)" ]; then env_set LAYERLING_DESIGNS_DIR "$(absolute_dir "$HOME/Layerling")"; fi
    if [ -z "$(env_get LAYERLING_PORT)" ]; then env_set LAYERLING_PORT "$(first_free_port 3000)"; fi
  fi

  # The rest describes the host. Run from the Updates button this script is inside the updater container,
  # where none of it would be true: keep what the last run from a terminal wrote.
  [ "$UI" = 1 ] && return 0

  # Where this folder is on the host: the updater mounts it at the same path, so compose finds everything.
  env_set LAYERLING_HOST_ROOT "$ROOT"
  if [ -z "$(env_get LAYERLING_UPDATER_TOKEN)" ]; then
    env_set LAYERLING_UPDATER_TOKEN "$(LC_ALL=C tr -dc 'a-f0-9' < /dev/urandom | head -c 48)"
  fi
  # A pin given on the command line is remembered, so the Updates button keeps to it.
  if [ -n "${LAYERLING_REF:-}" ]; then env_set LAYERLING_REF "$LAYERLING_REF"; fi

  if [ "$(uname)" = "Linux" ]; then
    # Run as you, so the designs and settings stay yours and need no chown.
    env_set LAYERLING_USER "$(id -u):$(id -g)"
    env_set LAYERLING_UPDATER_USER "$(id -u):$(id -g)"
    local socket=/var/run/docker.sock
    if [ -S "$socket" ]; then env_set DOCKER_GID "$(stat -c %g "$socket")"; fi
  fi
  mkdir -p "$ROOT/extension-data/thumbnails" "$(env_get LAYERLING_DESIGNS_DIR)"
}

# ---- 1. This repo ------------------------------------------------------------------------------------------------

if [ "$SELF_UPDATE" = 1 ]; then
  step host "Updating layerling-extensions"
  if git -C "$ROOT" rev-parse --is-inside-work-tree > /dev/null 2>&1 && git -C "$ROOT" rev-parse '@{u}' > /dev/null 2>&1 \
    && ! GIT_TERMINAL_PROMPT=0 git -C "$ROOT" fetch --quiet 2> /dev/null; then
    # Private, not on GitHub yet, or offline: layerling itself can still be updated.
    skip host "Couldn't reach $(git -C "$ROOT" remote get-url origin 2> /dev/null || echo origin) (private repo or offline), skipped."
  elif git -C "$ROOT" rev-parse --is-inside-work-tree > /dev/null 2>&1 && git -C "$ROOT" rev-parse '@{u}' > /dev/null 2>&1; then
    before="$(git -C "$ROOT" rev-parse HEAD)"
    git -C "$ROOT" merge --ff-only --quiet '@{u}' \
      || fail "Could not update layerling-extensions (local changes?). Commit or stash them, or run with --no-self-update."
    after="$(git -C "$ROOT" rev-parse HEAD)"
    if [ "$before" != "$after" ]; then
      echo "    ${before:0:7} -> ${after:0:7}"
      if [ "$UI" = 1 ] && ! git -C "$ROOT" diff --quiet "$before" "$after" -- updater; then echo "::self-update"; fi
      # Run the script we just pulled, not the rest of the old one.
      exec bash "$ROOT/scripts/update.sh" --self-updated ${ARGS[@]+"${ARGS[@]}"}
    fi
    echo "    Up to date ($(git -C "$ROOT" describe --tags --always))"
  else
    skip host "Not a git clone, skipped. Download the latest from GitHub to update it."
  fi
fi

ensure_env
REF="${LAYERLING_REF:-$(env_get LAYERLING_REF)}"
REF="${REF:-main}"

# ---- 2. layerling -------------------------------------------------------------------------------------------------

step fetch "Downloading layerling ($REF)"
if [ ! -d "$CORE/.git" ]; then
  git clone "$REPO" "$CORE"
fi
cd "$CORE"
git fetch --tags --force origin
# ./core is a build folder: throw away the previous hooks and start from a clean layerling.
git reset --hard -q
git clean -fdq
if git rev-parse -q --verify "origin/$REF" > /dev/null; then
  git checkout -q --detach "origin/$REF"
else
  git checkout -q --detach "$REF"
fi
echo "    layerling $(sed -nE 's/^ *"version": *"([^"]+)".*/\1/p' package.json | head -n 1) ($(git rev-parse --short HEAD))"

step apply "Adding the extension host"
"$ROOT/scripts/apply.sh" "$CORE"

# ---- 3. Build and start ------------------------------------------------------------------------------------------

[ "$BUILD" = 1 ] || exit 0
cd "$ROOT"
export BUILDKIT_PROGRESS=plain

step build "Building (a few minutes)"
if [ "$UI" = 1 ]; then
  "${COMPOSE[@]}" build layerling
else
  "${COMPOSE[@]}" build
fi

step restart "Restarting layerling"
if [ "$UI" = 1 ]; then
  # Only layerling: the updater running this keeps going.
  "${COMPOSE[@]}" up -d --no-deps layerling
else
  "${COMPOSE[@]}" up -d
fi

echo
echo "Done. layerling is at http://localhost:$(env_get LAYERLING_PORT)"
[ "$UI" = 1 ] && echo "::done"
exit 0
