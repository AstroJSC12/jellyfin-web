#!/usr/bin/env bash
# =====BEGIN HOMELAB DEPLOY=====
# Deploy this fork to the NAS. Wraps the canonical procedure
# documented at:
#   ~/Projects/homelab/compose/jellyfin-web-custom/README.md
#   (section "Deploying from the Mac (canonical path)")
#
# CRITICAL: the production webpack build (~2–4 GB peak RAM across
# ~1700 packages) MUST run on the Mac, never the NAS. This script
# enforces that by building on the Mac with `docker buildx
# --platform linux/amd64`, then shipping the prebuilt image to
# the NAS where `docker compose up -d --no-build` just runs it.
#
# Typical iteration:
#   ./scripts/homelab-deploy.sh
#
# Skip the local lint/typecheck (e.g. you already ran them):
#   ./scripts/homelab-deploy.sh --skip-checks
#
# Skip the git push (e.g. deploying an already-pushed commit):
#   ./scripts/homelab-deploy.sh --skip-push
#
# Re-copy the compose/nginx files to the NAS (only needed when
# you've changed Dockerfile / docker-compose.yml / nginx.conf in
# the homelab repo):
#   ./scripts/homelab-deploy.sh --copy-compose
#
# Pin a specific git ref (sha / tag / branch) for the in-image
# build instead of `master`:
#   ./scripts/homelab-deploy.sh --ref <sha-or-tag>
#
# Environment overrides (all optional):
#   NAS_HOST          ssh target (default: jsc12@jeff-nas.taild6c575.ts.net)
#   IMAGE_TAG         docker image tag (default: homelab/jellyfin-web-custom:latest)
#   HOMELAB_REPO      path to homelab repo (default: $HOME/Projects/homelab)
#   COMPOSE_REMOTE    compose dir on NAS (default: /volume1/docker/compose/jellyfin-web-custom)
#   VERIFY_URL        URL to curl after deploy (default: http://jeff-nas.taild6c575.ts.net:8097/)
#
# Exit codes: 0 success, non-zero on any failed stage.
# =====END HOMELAB DEPLOY=====

set -euo pipefail

# ---------- config ----------
NAS_HOST="${NAS_HOST:-jsc12@jeff-nas.taild6c575.ts.net}"
IMAGE_TAG="${IMAGE_TAG:-homelab/jellyfin-web-custom:latest}"
HOMELAB_REPO="${HOMELAB_REPO:-$HOME/Projects/homelab}"
COMPOSE_LOCAL="${COMPOSE_LOCAL:-$HOMELAB_REPO/compose/jellyfin-web-custom}"
COMPOSE_REMOTE="${COMPOSE_REMOTE:-/volume1/docker/compose/jellyfin-web-custom}"
VERIFY_URL="${VERIFY_URL:-http://jeff-nas.taild6c575.ts.net:8097/}"
NODE_PATH_PREFIX="${NODE_PATH_PREFIX:-/opt/homebrew/opt/node@24/bin}"

# ---------- flags ----------
SKIP_CHECKS=0
SKIP_PUSH=0
COPY_COMPOSE=0
REF=""

usage() {
    sed -n '/^# =====BEGIN HOMELAB DEPLOY=====/,/^# =====END HOMELAB DEPLOY=====/p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-checks) SKIP_CHECKS=1 ;;
        --skip-push)   SKIP_PUSH=1 ;;
        --copy-compose) COPY_COMPOSE=1 ;;
        --ref) REF="${2:-}"; shift ;;
        -h|--help) usage 0 ;;
        *) echo "unknown flag: $1" >&2; usage 1 ;;
    esac
    shift
done

# ---------- helpers ----------
banner() {
    local msg="$1"
    printf '\n\033[1;36m==> %s\033[0m\n' "$msg"
}

warn() {
    printf '\033[1;33m[warn]\033[0m %s\n' "$1" >&2
}

fail() {
    printf '\033[1;31m[fail]\033[0m %s\n' "$1" >&2
    exit 1
}

# Background heartbeat: prints elapsed seconds every $HEARTBEAT_INTERVAL
# while a stage runs so silent commands (eslint, tsc, docker save
# piped over ssh) don't look hung. Killed automatically on stage
# completion AND on signal via the top-level trap below.
HEARTBEAT_INTERVAL="${HEARTBEAT_INTERVAL:-10}"
_HEARTBEAT_PID=""

_start_heartbeat() {
    # Disable job-control notifications for the background process
    # so the spawn message doesn't pollute output.
    (
        local i=0
        while sleep "$HEARTBEAT_INTERVAL"; do
            i=$((i + HEARTBEAT_INTERVAL))
            printf '   ...still working (%ss elapsed)\n' "$i" >&2
        done
    ) &
    _HEARTBEAT_PID=$!
    disown "$_HEARTBEAT_PID" 2>/dev/null || true
}

_stop_heartbeat() {
    if [[ -n "$_HEARTBEAT_PID" ]]; then
        kill "$_HEARTBEAT_PID" 2>/dev/null || true
        wait "$_HEARTBEAT_PID" 2>/dev/null || true
        _HEARTBEAT_PID=""
    fi
}

# Make sure any orphaned heartbeat dies when the script does
# (clean exit, ctrl-C, or signal-driven termination).
trap '_stop_heartbeat' EXIT
trap '_stop_heartbeat; exit 130' INT
trap '_stop_heartbeat; exit 143' TERM

time_stage() {
    local label="$1"; shift
    local start end rc
    start=$(date +%s)
    _start_heartbeat
    # Run inside an if so set -e doesn't fire before we stop the
    # heartbeat; capture the real exit code and re-raise it.
    if "$@"; then
        rc=0
    else
        rc=$?
    fi
    _stop_heartbeat
    end=$(date +%s)
    printf '   (%s took %ss)\n' "$label" "$((end - start))"
    return $rc
}

# ---------- preflight ----------
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [[ -z "$REPO_ROOT" ]]; then
    fail "not inside a git repo; run from the jellyfin-web fork root"
fi

if [[ ! -f "$REPO_ROOT/HOMELAB_FORK_NOTES.md" ]]; then
    fail "this doesn't look like the jellyfin-web fork (no HOMELAB_FORK_NOTES.md). cwd: $REPO_ROOT"
fi

if [[ ! -d "$COMPOSE_LOCAL" ]]; then
    fail "compose dir not found: $COMPOSE_LOCAL (set HOMELAB_REPO or COMPOSE_LOCAL)"
fi

if ! command -v docker >/dev/null 2>&1; then
    fail "docker CLI not on PATH; install OrbStack (or Docker Desktop) and retry"
fi

# Talk to the daemon, not just the CLI. OrbStack / Docker Desktop
# can be installed but stopped — without this check, the build
# stage would fail four stages in with a cryptic socket error.
# `docker info` returns non-zero fast when no daemon is running.
if ! docker info >/dev/null 2>&1; then
    fail "docker daemon not reachable — start OrbStack (or Docker Desktop) and retry"
fi

if ! docker buildx version >/dev/null 2>&1; then
    fail "docker buildx not available; need OrbStack, Docker Desktop, or a buildx builder"
fi

# Make Node 24 available for lint / typecheck (matches AGENTS.md).
if [[ -d "$NODE_PATH_PREFIX" ]]; then
    export PATH="$NODE_PATH_PREFIX:$PATH"
fi

# ---------- summary ----------
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
CURRENT_SHA=$(git rev-parse --short HEAD)
DIRTY=""
if ! git diff-index --quiet HEAD --; then
    DIRTY=" (working tree dirty)"
fi
DEPLOY_REF="${REF:-$CURRENT_BRANCH}"

banner "Deploying jellyfin-web fork to $NAS_HOST"
cat <<INFO
  repo root:      $REPO_ROOT
  branch:         $CURRENT_BRANCH @ $CURRENT_SHA$DIRTY
  image tag:      $IMAGE_TAG
  build ref:      $DEPLOY_REF  (the Dockerfile will git-checkout this on the NAS-arch builder)
  compose local:  $COMPOSE_LOCAL
  compose remote: $NAS_HOST:$COMPOSE_REMOTE
  verify URL:     $VERIFY_URL
INFO

if [[ -n "$DIRTY" && $SKIP_PUSH -eq 0 ]]; then
    warn "working tree is dirty — uncommitted changes will NOT be in the deployed build"
    warn "(the Dockerfile clones fresh from GitHub; only pushed commits make it through)"
fi

# ---------- stage 1: local checks ----------
if [[ $SKIP_CHECKS -eq 0 ]]; then
    banner "1/6  Lint + type check (Node $(node --version 2>/dev/null || echo '???'))"
    time_stage "lint" npm run lint
    time_stage "build:check" npm run build:check
else
    banner "1/6  Lint + type check  (skipped)"
fi

# ---------- stage 2: git push ----------
if [[ $SKIP_PUSH -eq 0 ]]; then
    banner "2/6  Push $CURRENT_BRANCH to origin"
    if [[ -n "$REF" ]]; then
        warn "--ref was given; pushing current branch anyway so the ref is reachable"
    fi
    time_stage "git push" git push origin "$CURRENT_BRANCH"
else
    banner "2/6  Git push  (skipped — make sure ref '$DEPLOY_REF' is already on origin)"
fi

# ---------- stage 3: optional compose copy ----------
if [[ $COPY_COMPOSE -eq 1 ]]; then
    banner "3/6  Copy compose files to NAS"
    # scp on macOS now defaults to SFTP, which DSM doesn't enable.
    # -O forces the legacy SCP protocol.
    time_stage "scp" scp -O -r "$COMPOSE_LOCAL" "$NAS_HOST:$(dirname "$COMPOSE_REMOTE")/"
else
    banner "3/6  Copy compose files  (skipped — pass --copy-compose if compose/nginx/Dockerfile changed)"
fi

# ---------- stage 4: build image on Mac ----------
banner "4/6  Build $IMAGE_TAG for linux/amd64 (this is the heavy step, ~80s on M-series)"
# NB: macOS's system bash is 3.2; with `set -u`, expanding
# "${BUILD_ARGS[@]}" on an empty array (no --ref passed) throws
# "unbound variable". The `${arr[@]+"${arr[@]}"}` form expands to
# nothing when the array is empty and to the values otherwise.
BUILD_ARGS=()
if [[ -n "$REF" ]]; then
    BUILD_ARGS+=(--build-arg "REF=$REF")
fi
time_stage "docker build" docker buildx build \
    --platform linux/amd64 \
    ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} \
    -t "$IMAGE_TAG" \
    --load \
    "$COMPOSE_LOCAL"

# ---------- stage 5: ship image to NAS ----------
banner "5/6  Ship image to $NAS_HOST  (~100 MB gzipped tarball over ssh)"
# `docker save | gzip | ssh ... 'gunzip | sudo docker load'`. sudo on
# DSM strips PATH so the docker binary needs its full path.
time_stage "docker save+load" bash -c "
    set -o pipefail
    docker save '$IMAGE_TAG' | gzip | \
        ssh '$NAS_HOST' 'gunzip | sudo /usr/local/bin/docker load'
"

# ---------- stage 6: restart compose service on NAS ----------
banner "6/6  Restart compose service on NAS (with --no-build so the NAS never tries to rebuild)"
time_stage "compose up" ssh -t "$NAS_HOST" "
    cd '$COMPOSE_REMOTE' && \
    sudo /usr/local/bin/docker compose up -d --no-build
"

# ---------- verify ----------
banner "Verifying $VERIFY_URL"
HTTP_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' "$VERIFY_URL" || echo 'ERR')
if [[ "$HTTP_STATUS" != "200" ]]; then
    warn "expected HTTP 200, got: $HTTP_STATUS"
    warn "(container may still be starting; try again in a few seconds)"
else
    echo "   HTTP $HTTP_STATUS  ✓"
fi

BUILDINFO_URL="${VERIFY_URL%/}/.buildinfo"
BUILDINFO=$(curl -sS "$BUILDINFO_URL" 2>/dev/null || echo '???')
echo "   .buildinfo: $BUILDINFO"

banner "Done."
echo "Open the PWA at: $VERIFY_URL"
echo "Logs on NAS:     ssh $NAS_HOST 'cd $COMPOSE_REMOTE && sudo /usr/local/bin/docker compose logs --tail=50 -f'"
