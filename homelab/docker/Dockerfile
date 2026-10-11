# =====HOMELAB IMAGE BUILD=====
# CI variant of homelab/compose/jellyfin-web-custom/Dockerfile.
# Builds from the checked-out source (build context = repo root)
# instead of git-cloning, so CI builds exactly the commit it was
# triggered on. Run by .github/workflows/homelab-image.yml on
# GitHub runners. NEVER run this on the NAS.
#
# The image serves the production webpack build with nginx on
# port 80, same as the Mac-built image. /.buildinfo is one line:
#   building from <full 40-character commit sha>
# and the image label org.opencontainers.image.revision is that
# same sha. The NAS update script reads the label and curls
# :8097/.buildinfo.
# =====END HOMELAB IMAGE BUILD=====

# --- stage 1: build ---------------------------------------------------------
FROM node:24-alpine AS builder
RUN apk add --no-cache git
WORKDIR /src

COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

COPY . .
ARG GIT_SHA=unknown
# webpack.common.js stamps `git describe --always --dirty` into the
# page. That needs a real checkout (see .dockerignore) and a
# safe.directory entry, because this stage runs as root.
# Drop hookspath / credential headers if a local .git/config has
# them, so they are not required at build time and are not reused.
RUN set -eu; \
    git config --global --add safe.directory /src; \
    git config --local --unset-all core.hookspath || true; \
    git config --local --unset-all http.https://github.com/.extraheader || true; \
    desc="$(git describe --always --dirty)"; \
    echo "git describe: ${desc}"; \
    case "${desc}" in \
      ""|*-dirty) echo "expected a clean git describe, got: ${desc}" >&2; exit 1 ;; \
    esac; \
    case "${GIT_SHA}" in \
      unknown) ;; \
      *) printf '%s' "${GIT_SHA}" | grep -Eq '^[0-9a-f]{40}$' \
           || { echo "GIT_SHA must be the full 40-character commit sha" >&2; exit 1; } ;; \
    esac; \
    npm run build:production; \
    printf 'building from %s\n' "${GIT_SHA}" > /src/.buildinfo

# --- stage 2: serve ---------------------------------------------------------
FROM nginx:alpine
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.title="jellyfin-web-custom" \
      org.opencontainers.image.description="Jeff's homelab jellyfin-web fork (Infuse handoff)"
COPY --from=builder /src/dist /usr/share/nginx/html
COPY --from=builder /src/.buildinfo /usr/share/nginx/html/.buildinfo
COPY homelab/docker/nginx.conf /etc/nginx/conf.d/default.conf
RUN nginx -t \
 && test -s /usr/share/nginx/html/index.html \
 && test -s /usr/share/nginx/html/.buildinfo
EXPOSE 80
