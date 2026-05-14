# Jellyfin Web (homelab fork) — Agent Guidance

Fork of `jellyfin/jellyfin-web`. Single user (Jeff). Single
purpose: a Jellyfin browse UI whose Play button hands off to
Infuse via `infuse://x-callback-url/play?url=…&filename=…`.

Everything else is upstream. Read `HOMELAB_FORK_NOTES.md`
first for "what changed and why."

## Sister repo

- `~/Projects/homelab` — the homelab ops repo. Has its own
  `AGENTS.md` with broader rules (NAS, snapshots, no secrets,
  etc.). Don't conflate the two.
- Files in the sister repo are reachable via absolute-path
  `read_file` and `run_command` from this workspace. They are
  **not** reachable via `grep_search` (workspace-scoped). Use
  shell `grep`/`find` via `run_command` if you need to search
  the sister repo.

Key cross-repo references (all absolute paths):

- `/Users/jeffcoy/Projects/homelab/docs/MEDIA_UI_SPEC.md` —
  full spec, v1 scope, v2+ wish list, why this fork exists.
- `/Users/jeffcoy/Projects/homelab/docs/INFUSE_URL_SCHEME.md` —
  verified Infuse URL contract, scene-style filename
  conventions, the "Stream" AirPlay metadata bug.
- `/Users/jeffcoy/Projects/homelab/scripts/make-infuse-url.sh` —
  byte-equivalent reference implementation. The fork's Play
  button must produce identical URLs for the same item.
- `/Users/jeffcoy/Projects/homelab/docs/ROADMAP.md` — project-
  wide roadmap. Media UI section tracks this fork's progress.
- `/Users/jeffcoy/Projects/homelab/compose/jellyfin-web-custom/`
  — deployment scaffold (nginx serving the built `dist/` on
  port 8097 of the NAS). Build / deploy notes there.

## Hard rules

- **Don't break the Infuse URL contract.** The Play button
  emits `infuse://x-callback-url/play?url=<encoded stream
  URL>&filename=<encoded scene-style filename>`. Filename
  conventions are documented in `INFUSE_URL_SCHEME.md` and
  reference-implemented in `make-infuse-url.sh`. If you change
  either, run `make-infuse-url.sh` and the fork's builder
  against the same item and confirm byte-identical output
  before committing.
- **Keep customizations surgical and clearly delimited.**
  Every fork-specific change wraps in marker comments:
  `// =====BEGIN HOMELAB INFUSE HANDOFF=====` … `// =====END
  HOMELAB INFUSE HANDOFF=====` (or a similar `HOMELAB <FEATURE
  NAME>` token for future v2 work). This is the rebase-pain
  contract: upstream rebases stay surgical only if our diff is
  visibly local.
- **Don't refactor outside the marker blocks.** If a v2 feature
  tempts you to "while I'm here, clean up this nearby code,"
  the answer is no — that's exactly the change that turns the
  next upstream rebase into a multi-hour merge-conflict slog.
- **Never commit secrets.** API keys, access tokens, server
  URLs with embedded auth — none of it goes in source. The
  fork's URL builder reads the access token from the live
  `apiClient` at runtime; there's no static config to leak.
- **Node 24 required.** `engines.node >= 24` with
  `engine-strict=true` in `.npmrc`. Installed keg-only at
  `/opt/homebrew/opt/node@24/bin` so as not to clobber the
  user's global Node 23 (used by other projects). Use the
  explicit PATH prefix for every command:
  ```bash
  PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm <command>
  ```

## Workflow norms

- **Before committing**, always run:
  ```bash
  PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run lint -- <changed-files>
  PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run build:check
  ```
  Production build (`npm run build:production`, ~80s) before
  any deploy.
- **Branches**: master-only is fine while the fork is a
  single-feature implementation. Once v2 work starts, use
  `homelab/<feature>` branch names for upstream-rebase
  ergonomics.
- **Rebasing against upstream** (`jellyfin/jellyfin-web`
  master) is a periodic chore:
  ```bash
  git remote add upstream https://github.com/jellyfin/jellyfin-web.git
  git fetch upstream
  git rebase upstream/master
  ```
  If conflicts hit any `=====HOMELAB=====` block, resolve them
  carefully. Read `MEDIA_UI_SPEC.md` if you forget *why* a
  given patch exists.
- **When changing fork behavior, update
  `HOMELAB_FORK_NOTES.md`** so the next session (or the next
  Jeff) doesn't have to re-derive what the patch does.
- **Crash-course voice** for docs (matching homelab repo): for
  a smart non-engineer reader. Conversational, concrete
  examples, "why this" framing. No jargon dumps.

## Dev / build commands (cheat sheet)

```bash
# Dev server with hot-reload, http://localhost:8080
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm start

# Lint a specific file (faster than whole-tree)
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run lint -- src/components/playback/playbackmanager.js

# Type check (no emit)
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run build:check

# Production build (output: dist/)
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run build:production

# Tests
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm test
```

## Verifying the Infuse handoff round-trips

Quick sanity check that the fork still emits the contract
shape after any playback-touching change:

```bash
# Build, then look for the URL skeleton in the bundle:
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run build:production \
  && grep -q "x-callback-url/play" dist/main.jellyfin.bundle.js \
  && echo "OK: Infuse handoff present in bundle" \
  || echo "FAIL: Infuse handoff missing — check playbackmanager.js"
```

This is a coarse smoke test (proves the string is in the
bundle, not that the dispatch logic is wired right). The full
verification is `npm start` → log in → click Play → confirm
Safari navigates to an `infuse://...` URL.
