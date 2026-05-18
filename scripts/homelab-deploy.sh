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

# Same as time_stage but without the heartbeat — for stages that
# prompt the user (e.g. sudo password). A ticker writing
# "...still working" would clobber the password prompt and
# generally make interactive output messy.
time_stage_interactive() {
    local label="$1"; shift
    local start end rc
    start=$(date +%s)
    if "$@"; then
        rc=0
    else
        rc=$?
    fi
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
# Default --ref to the current commit SHA when not explicitly
# given. This is critical: it pins the Dockerfile's `git checkout`
# to a specific SHA, which means the docker layer cache
# invalidates on every new commit. If we let it default to the
# literal string "master" the RUN command never changes, so
# docker happily re-uses the cached layer that has yesterday's
# code checked out — the bug Jeff saw where dev notes / scroll
# fix / shuffle pre-mark all ran through deploy but never made
# it to the NAS.
if [[ -z "$REF" ]]; then
    REF=$(git rev-parse HEAD)
fi
DEPLOY_REF="$REF"

banner "Deploying jellyfin-web fork to $NAS_HOST"
cat <<INFO
  repo root:      $REPO_ROOT
  branch:         $CURRENT_BRANCH @ $CURRENT_SHA$DIRTY
  image tag:      $IMAGE_TAG
  build ref:      $DEPLOY_REF  (pinned SHA; invalidates docker cache per-commit)
  compose local:  $COMPOSE_LOCAL
  compose remote: $NAS_HOST:$COMPOSE_REMOTE
  verify URL:     $VERIFY_URL
INFO

if [[ -n "$DIRTY" && $SKIP_PUSH -eq 0 ]]; then
    warn "working tree is dirty — uncommitted changes will NOT be in the deployed build"
    warn "(the Dockerfile clones fresh from GitHub; only pushed commits make it through)"
fi

# ---------- stage 1: cache NAS sudo password ----------
# Prompt once up front so the rest of the script runs unattended.
# Password is held in a shell variable for the duration of the
# script and piped to remote `sudo -S` via stdin in stage 7. It's
# never put in a process arg, env var, or shell history, so it's
# not visible via `ps`. printf is a bash builtin, so even the
# pipe-construction step doesn't fork a process carrying the
# value. Stays in memory for ~3 minutes during deploy.
banner "1/7  Cache NAS sudo password (one-time prompt, then walk away)"
NAS_SUDO_PASS=""
read -r -s -p "   NAS sudo password for $NAS_HOST: " NAS_SUDO_PASS
echo
if [[ -z "$NAS_SUDO_PASS" ]]; then
    fail "no password entered; aborting"
fi
# Validate immediately so a typo doesn't waste 80 seconds of
# build time. `sudo -k` first clears any cached creds so we're
# actually testing the password we just got, not a stale cache.
# `-S` reads password from stdin, `-p ""` suppresses the prompt
# string (we don't need it since we're piping). `-v` just
# refreshes the credential timestamp without running a command.
if ! printf '%s\n' "$NAS_SUDO_PASS" | ssh "$NAS_HOST" "sudo -k -S -p '' -v" >/dev/null 2>&1; then
    fail "sudo password did not validate against $NAS_HOST; check it and retry"
fi
echo "   password validated, sudo cache refreshed on NAS ✓"

# Helper to run a multi-line script as root on the NAS with the
# cached password. Password is piped via stdin (not args), so it
# doesn't leak into `ps`. The remote command runs under `sh -c`
# inside sudo, which we accomplish by reading the script body on
# the remote side via heredoc.
remote_sudo_script() {
    local script="$1"
    # Concatenate password + script body, separated by newline.
    # sudo reads up to the first newline as password, then runs
    # the command with the rest available on stdin (but we pass
    # the script as -c arg, not stdin, so the rest is ignored).
    printf '%s\n' "$NAS_SUDO_PASS" \
        | ssh "$NAS_HOST" "sudo -S -p '' bash -c $(printf '%q' "$script")"
}

# ---------- stage 2: local checks ----------
if [[ $SKIP_CHECKS -eq 0 ]]; then
    banner "2/7  Lint + type check (Node $(node --version 2>/dev/null || echo '???'))"
    # --quiet suppresses warnings and only shows errors. Upstream
    # Jellyfin has ~96 pre-existing warnings in stock code (Grid
    # deprecations, HACK comments, fixme tags, etc.) that flood
    # the deploy output every run. They never block the build
    # (warnings ≠ errors) but make it hard to see what's actually
    # happening. If our fork ever adds a real lint *error* (not a
    # warning), eslint will print it and exit non-zero, which
    # time_stage will treat as failure.
    time_stage "lint" npm run lint -- --quiet
    time_stage "build:check" npm run build:check
else
    banner "2/7  Lint + type check  (skipped)"
fi

# ---------- stage 3: git push ----------
if [[ $SKIP_PUSH -eq 0 ]]; then
    banner "3/7  Push $CURRENT_BRANCH to origin"
    time_stage "git push" git push origin "$CURRENT_BRANCH"
else
    banner "3/7  Git push  (skipped — make sure ref '$DEPLOY_REF' is already on origin)"
fi

# ---------- stage 4: optional compose copy ----------
if [[ $COPY_COMPOSE -eq 1 ]]; then
    banner "4/7  Copy compose files to NAS"
    # scp on macOS now defaults to SFTP, which DSM doesn't enable.
    # -O forces the legacy SCP protocol.
    time_stage "scp" scp -O -r "$COMPOSE_LOCAL" "$NAS_HOST:$(dirname "$COMPOSE_REMOTE")/"
else
    banner "4/7  Copy compose files  (skipped — pass --copy-compose if compose/nginx/Dockerfile changed)"
fi

# ---------- stage 5: build image on Mac ----------
banner "5/7  Build $IMAGE_TAG for linux/amd64 @ $DEPLOY_REF (this is the heavy step, ~80s on M-series)"
# NB: macOS's system bash is 3.2; with `set -u`, expanding
# "${BUILD_ARGS[@]}" on an empty array throws "unbound variable".
# The `${arr[@]+"${arr[@]}"}` form expands to nothing when empty
# and to the values otherwise.
#
# We always pass --build-arg REF=<sha> (set above) so the
# Dockerfile's git-checkout RUN string differs per commit and
# docker's layer cache invalidates cleanly. Without this the
# build silently reuses yesterday's checkout (see comment near
# REF default).
BUILD_ARGS=(--build-arg "REF=$REF")
time_stage "docker build" docker buildx build \
    --platform linux/amd64 \
    "${BUILD_ARGS[@]}" \
    -t "$IMAGE_TAG" \
    --load \
    "$COMPOSE_LOCAL"

# ---------- stage 6: upload image to NAS ----------
# Passwordless scp; the sudo-needing steps run in stage 7 using
# the password cached at stage 1.
banner "6/7  Upload image to $NAS_HOST  (~100 MB gzipped, scp)"
REMOTE_TARBALL="/tmp/jellyfin-web-image-$$.tar.gz"
LOCAL_TARBALL="$(mktemp -t jellyfin-web-image.XXXXXX).tar.gz"

# Make sure we clean up the local tarball no matter how the
# script exits. The remote tarball is removed by stage 7's
# trailing `rm` (and is on tmpfs anyway, so it's gone on reboot).
add_local_tarball_cleanup() {
    local existing
    existing=$(trap -p EXIT | sed -n "s/^trap -- '\(.*\)' EXIT$/\1/p")
    trap "${existing}; rm -f '$LOCAL_TARBALL'" EXIT
}
add_local_tarball_cleanup

time_stage "docker save" bash -c "
    set -o pipefail
    docker save '$IMAGE_TAG' | gzip > '$LOCAL_TARBALL'
"
time_stage "scp upload" scp -O "$LOCAL_TARBALL" "$NAS_HOST:$REMOTE_TARBALL"

# ---------- stage 7: load image + restart on NAS (unattended) ----------
banner "7/7  Load image + restart container on NAS (unattended; cached password)"
# Build the remote script as a single string, then run it via
# remote_sudo_script which pipes our cached password to sudo -S.
# All the commands run as root inside the one sudo invocation.
REMOTE_SCRIPT="
set -eo pipefail
gunzip < '$REMOTE_TARBALL' | /usr/local/bin/docker load
rm -f '$REMOTE_TARBALL'
cd '$COMPOSE_REMOTE'
/usr/local/bin/docker compose up -d --no-build
"
time_stage "load + compose up" remote_sudo_script "$REMOTE_SCRIPT"

# ---------- verify ----------
# Nginx inside the new container needs a moment after `Started`
# to actually accept connections — previously this stage would
# report HTTP 000 / empty reply if curl happened to fire during
# that ~1s window. Retry up to ~20s before giving up.
banner "Verifying $VERIFY_URL"
HTTP_STATUS=""
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    HTTP_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$VERIFY_URL" 2>/dev/null || echo '000')
    if [[ "$HTTP_STATUS" == "200" ]]; then
        echo "   HTTP $HTTP_STATUS  ✓  (attempt $attempt)"
        break
    fi
    if [[ $attempt -lt 10 ]]; then
        sleep 2
    fi
done
if [[ "$HTTP_STATUS" != "200" ]]; then
    warn "still no HTTP 200 after 10 attempts (got: $HTTP_STATUS)"
    warn "check container logs: ssh $NAS_HOST 'cd $COMPOSE_REMOTE && sudo /usr/local/bin/docker compose logs --tail=50'"
fi

BUILDINFO_URL="${VERIFY_URL%/}/.buildinfo"
BUILDINFO=$(curl -sS --max-time 3 "$BUILDINFO_URL" 2>/dev/null || echo '???')
echo "   .buildinfo: $BUILDINFO"

banner "Done."
echo "Open the PWA at: $VERIFY_URL"
echo "Logs on NAS:     ssh $NAS_HOST 'cd $COMPOSE_REMOTE && sudo /usr/local/bin/docker compose logs --tail=50 -f'"
