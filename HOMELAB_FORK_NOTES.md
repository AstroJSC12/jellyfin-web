# Homelab fork — what this is, what changed, how to work on it

This is Jeff's fork of `jellyfin/jellyfin-web`. The whole point
of the fork is to **swap the Play button's behavior**: instead
of dispatching to the in-browser HTML5 player, hand off video
playback to Infuse via its `x-callback-url/play` deep-link
scheme with a scene-style `filename=` hint. Everything else is
stock upstream — same browse, search, settings, library views.

Companion docs in the homelab repo (`~/Projects/homelab`):

- `docs/MEDIA_UI_SPEC.md` — the full spec, scope, and rationale.
- `docs/INFUSE_URL_SCHEME.md` — verified Infuse URL shape, the
  "Stream" metadata bug, scene-style filename conventions.
- `scripts/make-infuse-url.sh` — canonical URL-builder reference
  implementation. The fork's Play-button URL builder produces
  byte-identical output to this script for the same Jellyfin
  item.
- `compose/jellyfin-web-custom/` — deployment scaffold (nginx
  serving the built `dist/`, port 8097, not yet deployed).

## What was changed (3 files + 1 PWA polish)

All edits marked with `=====BEGIN HOMELAB INFUSE HANDOFF=====`
/ `=====END HOMELAB INFUSE HANDOFF=====` comments so future
rebases against `jellyfin/jellyfin-web` `master` stay
surgical. `git log --grep="HOMELAB"` finds the commit history.

- **`src/components/apphost.js`** — pushes
  `AppFeature.ExternalPlayerIntent` into the supported-features
  list. This makes the Settings UI surface the "Enable external
  video player" toggle.
- **`src/scripts/settings/appSettings.js`** —
  `enableSystemExternalPlayers` default flipped from `false`
  to `true`. The toggle still works either direction; the
  default just matches the fork's purpose.
- **`src/components/playback/playbackmanager.js`** —
  - New helper `tryBuildInfuseUrl(options)` builds the
    `infuse://x-callback-url/play?url=…&filename=…` URL for the
    first video item the user is trying to play. Returns null
    for audio, unknown types, or when metadata is missing.
  - `self.play()` checks the setting at the top of the function;
    if on and the helper returns a URL, navigate to it and
    return. Audio and unsupported types fall through to upstream
    behavior.
- **`src/manifest.json` + `src/index.html`** — PWA name flipped
  to "Media (Homelab)" / short_name "Media". So the home-screen
  install on iPhone/iPad/Mac doesn't say "Jellyfin."

The full diff is small:

```
src/components/apphost.js                  |  8 +++
src/components/playback/playbackmanager.js | 89 +++++++++++++++++++++
src/manifest.json                          |  6 +-
src/scripts/settings/appSettings.js        |  9 ++-
src/index.html                             |  4 +-
```

## URL shape produced by the Play button

For an episode:

```
infuse://x-callback-url/play
  ?url=<urlencoded http://server/Videos/<id>/stream?static=true&api_key=<token>&MediaSourceId=<id>>
  &filename=<urlencoded {SeriesName}.S{n}E{n}.{EpisodeName}.mp4>
```

For a movie:

```
&filename=<urlencoded {Title}.{Year}.mp4>
```

This is the verified-working shape documented in
`~/Projects/homelab/docs/INFUSE_URL_SCHEME.md`. The
`scripts/make-infuse-url.sh` reference implementation produces
identical output — if the script's URL works on iPhone +
AirPlay, the fork's Play button will too.

## Dev loop

```bash
cd ~/Projects/jellyfin-web

# Webpack dev server, hot-reload. Opens http://localhost:8080.
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm start
```

First-time login: select "Connect to a server manually,"
enter `http://192.168.1.151:8096`, sign in as `jeff`. The dev
server proxies / serves the SPA but doesn't proxy API calls —
you're hitting Jellyfin directly from the browser.

Click Play on any episode or movie. The browser should navigate
to an `infuse://x-callback-url/play?url=…&filename=…` URL. On
the Mac that opens Infuse if it's installed; on iPhone the
same URL opens Infuse natively.

If you want to test the in-browser fallback path: Settings →
Playback → uncheck "Enable external video player" → Play
plays in the browser as upstream Jellyfin does.

## Production build

```bash
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run build:production
# Output: dist/ (~59 MB of static files, ready for nginx)
```

On the NAS, the `homelab/compose/jellyfin-web-custom/`
Dockerfile does this build from a fresh clone of this fork on
every `docker compose up --build`. Pushing to `master` then
running `docker compose up --build` on the NAS is the deploy
loop.

## Node version

`.nvmrc` and `package.json` engines pin Node `>=24` (with
`engine-strict=true` in `.npmrc`). On Jeff's Mac this is
installed keg-only via `brew install node@24` and accessed
explicitly:

```bash
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm <command>
```

The global Node 23 stays as-is for everything else
(`command-center` and friends). If you ever want Node 24 to be
the default:

```bash
echo 'export PATH="/opt/homebrew/opt/node@24/bin:$PATH"' >> ~/.bash_profile
```

## Rebasing against upstream

Periodic chore to absorb upstream changes:

```bash
git remote add upstream https://github.com/jellyfin/jellyfin-web.git
git fetch upstream
git rebase upstream/master

# If conflicts hit any of the =====HOMELAB===== blocks, resolve
# them carefully. Read docs/MEDIA_UI_SPEC.md if you forget why
# any specific patch exists.
```

Keep the patches surgical and clearly delimited and this stays
a 5-minute chore. If you start touching internals beyond the
=====HOMELAB===== blocks, expect rebases to get painful — and
ask whether the new code should live elsewhere (a separate
plugin, a userscript, a sidecar service).

## Status notes

- **Build verified** end-to-end (`npm run build:production` =
  clean exit, 2 pre-existing bundle-size warnings unrelated to
  the patch).
- **Lint clean** on all three patched files (1 pre-existing
  warning on `playbackmanager.js:2667` unrelated to us).
- **`build:check` (tsc --noEmit)** clean.
- **Dev loop not yet exercised end-to-end** — `npm start` not
  run yet because that needs interactive login + click-Play to
  validate. Next session: Jeff runs `npm start`, logs in,
  clicks Play, confirms Safari navigates to `infuse://...`.
- **Not yet deployed.** Compose service scaffolded at
  `homelab/compose/jellyfin-web-custom/` but not yet built or
  run on the NAS.
- **iPhone AirPlay metadata not yet verified.** Will happen
  once `scripts/make-infuse-url.sh --copy "..."` is tap-tested
  on the actual hardware. Same URL convention either way.

## Branch / commit hygiene

For v1, working directly on `master` is fine (single-user
single-purpose fork). When the v2+ feature work starts, switch
to feature branches with the `homelab/<feature>` naming
convention so upstream-rebase mechanics stay clean.
