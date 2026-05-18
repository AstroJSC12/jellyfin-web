# Homelab fork — what this is, what changed, how to work on it

This is Jeff's fork of `jellyfin/jellyfin-web`. The whole point
of the fork is to **swap the Play button's behavior**: instead
of dispatching to the in-browser HTML5 player, hand off video
playback to Infuse via its `x-callback-url/play` deep-link
scheme with a scene-style `filename=` hint. Everything else is
stock upstream — same browse, search, settings, library views.

> ## ⚠️ HARD RULE: never build this fork on the NAS
>
> The production webpack build (`npm run build:production`, or
> `docker compose --build` from `compose/jellyfin-web-custom/`)
> peaks at 2–4 GB of RAM and runs across ~1700 packages. Jeff's
> Synology NAS does **not** have the headroom while also serving
> Jellyfin, Plex, Command Center, and DSM. Running it on the NAS
> on 2026-05-14 OOM-killed the box hard enough that it lost
> Tailscale, dropped SSH, and needed a physical power-cycle.
>
> **Always build on the Mac (M3 Pro, ~80s), then ship the prebuilt
> image to the NAS.** Exact commands live in
> `~/Projects/homelab/compose/jellyfin-web-custom/README.md`
> under "Deploying from the Mac (canonical path)."
>
> The `Dockerfile` and `docker-compose.yml` still contain a
> `build:` block for documentation purposes — but it must not be
> exercised against the NAS Docker daemon. Always use
> `docker compose up -d --no-build` on the NAS.

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

## What was changed (3 upstream files + 2 new fork-only files + PWA polish)

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
  - Imports `buildInfuseUrl` from the new sibling module (see
    below).
  - `tryBuildInfuseUrl(options)` resolves the first item from
    the play() options bag (handles both pre-fetched items and
    id-only paths) and delegates to `buildInfuseUrl` for the
    URL synthesis.
  - `self.play()` checks the setting at the top of the function;
    if on and the helper returns a URL, navigate to it and
    return. Audio, unknown types, and missing-context items
    fall through to upstream behavior.
- **`src/components/playback/infuseUrl.js`** — new fork-only
  file. Pure URL builder (`buildInfuseUrl`, `buildInfuseFilename`,
  `rfc3986Encode`). Lives in its own module so it can be unit-
  tested in isolation, and so the URL contract is in a file
  upstream never touches → zero rebase risk for the meat of the
  feature.
- **`src/components/playback/infuseUrl.test.js`** — new fork-
  only file. Vitest regression tests locking in the URL shape
  byte-for-byte against `make-infuse-url.sh`. Includes an
  apostrophe fixture (`Bob's Burgers`) to catch the canonical
  divergence between `encodeURIComponent` and `jq @uri`.
- **`src/manifest.json` + `src/index.html`** — PWA name flipped
  to "Media (Homelab)" / short_name "Media". So the home-screen
  install on iPhone/iPad/Mac doesn't say "Jellyfin."

## Feature: IMDb-rating sort default (2026-05-14)

Surgical UX patch added after Jeff observed Infuse's "Sort by
Rating" is a daily-use feature he wanted carried over. Two edits
+ a new test file, all wrapped in `=====BEGIN HOMELAB IMDB SORT=====`
markers so the diff stays visible during rebases.

- **`src/strings/en-us.json`** — two label rename only. Stock
  Jellyfin labels both the header field and the sort menu option
  as "Community Rating," but in this deployment the OMDb plugin
  populates that field with IMDb's 0–10 score. Renamed to
  "IMDb rating" / "IMDb Rating" so the sort menu is findable
  and the item-detail rating row reads correctly. Keys touched:
  `CommunityRating` (line 179), `OptionCommunityRating`
  (line 1308). Other languages keep the upstream label; only
  `en-us` is exercised in this deployment.

- **`src/utils/items.ts`** — three marker blocks. Introduces a
  `HOMELAB_IMDB_SORT_VIEWS` set ({Movies, Series, Favorites,
  Collections, Mixed}) and threads it through
  `getDefaultSortBy()` and `getDefaultLibraryViewSettings()` so
  those views default to `CommunityRating, Descending` instead
  of `SortName, Ascending`. Also bumps the `getSettingsKey()`
  return value with a `- homelab.v1` suffix so existing PWA
  installs ignore their stale upstream-default cached
  preferences on first load after this ships. Other views
  (Episodes, Songs, Albums, etc.) keep upstream defaults
  untouched.

- **`src/utils/items.homelab.test.ts`** — new fork-only file.
  21 Vitest tests locking in the IMDb-sort view set, the
  paired Descending order, the upstream-untouched views, and
  the `homelab.v1` storage-key suffix. Mocks
  `scripts/settings/userSettings` and `components/layoutManager`
  out so the test can run without booting apphost/globalize
  in jsdom. If upstream renames a `LibraryTab` enum, expands
  `getDefaultSortBy`, or changes the storage-key shape, these
  fail loudly during rebase.

**Why this is safe-ish across rebases:** the marker blocks are
inside three small, focused functions; upstream rarely touches
them (last meaningful change was ~2024). If `getDefaultSortBy`
grows a third special case upstream, the merge conflict will
be small and obvious — keep both branches' special cases and
re-order so HOMELAB_IMDB_SORT_VIEWS is checked first.

**Why the storage-key bump matters:** without it, a returning
user (e.g. Jeff after the v1 ship on 2026-05-14) would have
`{viewType: 'movies', parentId: 'xyz'}: {SortBy: SortName,
SortOrder: Ascending}` already in localStorage from their first
visit. `useLocalStorage` short-circuits past the new defaults
and the change would be invisible. Bumping the key invalidates
one round of cached prefs per minor version. Users with
intentional custom sorts will re-set them once.

## Feature: Series/Season shuffle picks unplayed only (2026-05-14)

Carries the iOS Shortcut's "shuffle only unwatched episodes" behavior
into the web UI's Shuffle button. Wraps in `=====BEGIN HOMELAB SHUFFLE
UNPLAYED=====` markers.

- **`src/components/playback/playbackmanager.js`** — one marker block
  inside `getSeriesOrSeasonPlaybackPromise`. Two behaviors:

  1. **Pick from unplayed only.** When `options.shuffle` is true and
     the user is shuffling a Series or Season, the
     `apiClient.getEpisodes` call includes `Filters: 'IsUnplayed'`. If
     the result comes back empty (every episode in scope is already
     watched), we re-query without the filter, call
     `apiClient.markUnplayed(UserId, episodeId, date)` for each played
     episode, then re-query for the random pick. This mirrors
     `scripts/play-random-unplayed.sh --auto-reset` from the homelab
     repo exactly.
  2. **Pre-mark played at trigger time** (added 2026-05-18). As soon
     as a random episode is picked, fire `apiClient.markPlayed` on
     it before playback starts. Without this, hitting Shuffle and
     skipping out partway leaves the episode "unplayed", so the next
     Shuffle keeps re-picking the same handful from a shrinking pool.
     The explicit trade-off: shuffle history fidelity is sacrificed
     for genuine variety. Call is fire-and-forget; failure logs a
     warning and degrades to upstream behavior. Click-to-play and
     ordered queues are NOT affected — they still mark-on-complete
     via the in-browser player or the Infuse handoff.

  Non-shuffle (in-order) playback is untouched throughout.

**Source of truth is Jellyfin server-side `UserData.Played`**, so this
auto-syncs with the iOS Shortcut, the shell script
(`play-random-unplayed.sh`), and any other Jellyfin client — they all
read/write the same flag.

**Scope:** Series detail page Shuffle button, Season detail page
Shuffle button, and any other code path that ends in
`getSeriesOrSeasonPlaybackPromise` with `options.shuffle === true`.
Does NOT touch shuffle for Movies, Collections, BoxSets, Playlists,
Music, or Photos — those still shuffle across all items as upstream
does.

**Why we didn't merge this into the homelab repo as a shared lib:**
the shell script is the iOS Shortcut backend (runs on the Mac, builds
Infuse URLs for AirPlay handoff). The fork patch is the web UI
button (runs in the browser, uses the SDK). They have different
runtimes and different entry points; the only shared "state" is
already on the Jellyfin server. Trying to share code between them
would mean shipping a JS module into a bash script context — net
negative.

## Feature: Back button visible in the browser (2026-05-17)

Tiny one-line patch in
`src/apps/experimental/components/AppToolbar/index.tsx`,
wrapped in `=====BEGIN HOMELAB BACK BUTTON=====` markers.

Upstream gates the toolbar back button on `window.NativeShell`,
so it only ever renders inside the Jellyfin Media Player desktop
wrappers — never in a plain browser. That's why drilling into a
library item in the fork (Safari on Mac/iPad) leaves you with no
way back to the previous view except clicking "Home" and
re-navigating.

The fix is to drop the `window.NativeShell &&` clause:

```ts
const isBackButtonAvailable = appRouter.canGoBack(location.pathname);
```

`appRouter.canGoBack` already does the right thing — it checks
`window.history.length` and short-circuits to `false` on
START_PAGE_PATHS like `/home` so the button doesn't render when
there's nowhere meaningful to go. The wiring (icon, click
handler, `appRouter.back()`) was already in
`src/components/toolbar/AppToolbar.tsx`; we just weren't being
allowed to use it.

**Why this is rebase-safe:** the change is one expression on
one line, behind clear marker comments, and the underlying
`canGoBack` API is upstream-stable. If upstream eventually
ships the same fix, the rebase conflict will be obvious — drop
our marker block and take theirs.

## Feature: Mark-on-handoff for "Continue Watching" (2026-05-17)

The Infuse handoff has a structural blind spot: Infuse plays
from a raw `/Videos/{id}/stream?static=true&api_key=...` URL
with no session token, so it never hits Jellyfin's
`/Sessions/Playing` or `/Sessions/Playing/Stopped` endpoints.
Jellyfin's `UserData.LastPlayedDate`, `Played`, and
`PlaybackPositionTicks` therefore stay frozen at whatever they
were before Infuse got involved. Practical consequence: clicking
"Continue Watching" / "Next Up" in the web UI for the
just-finished episode would re-launch the same episode forever,
because Jellyfin still thinks it's the resume target.

Fix lives inside the existing `=====HOMELAB INFUSE HANDOFF=====`
marker block in `playbackmanager.js` — no new marker scope:

- `tryBuildInfuseUrl(options)` now returns
  `{ url, item, apiClient }` (or null) instead of just the URL
  string, so the caller has the context to mark the item played.
- New helper `markInfuseHandoffPlayed(handoff)` calls
  `apiClient.markPlayed(userId, itemId, new Date())`
  fire-and-forget. We don't `await` before navigating to the
  `infuse://` URL — setting `location.href` to a custom-scheme
  URL doesn't unload the page, so the in-flight XHR completes
  normally. Failures are logged and swallowed.
- `self.play()` now calls the marker before
  `window.location.href = handoff.url`.

**Trade-off:** if the user dispatches the URL but cancels
Safari's "Open in Infuse?" prompt (or bails 30s into Infuse
playback), the item is still marked Played. Recovery is the
manual "Mark Unplayed" button on the item-detail page.
Acceptable because the alternative — the actual upstream
behavior — is the bug we're fixing.

**Sister-repo scripts get the same patch.** The same handoff
blind spot bites
`~/Projects/homelab/scripts/play-next-episode.sh` and
`~/Projects/homelab/scripts/play-random-unplayed.sh` (the iOS
Shortcut backends). Both now POST
`/Users/{uid}/PlayedItems/{epId}` at script exit, after printing
the URL line. Same trade-off, same recovery.

**Why this is rebase-safe:** the change is fully inside the
existing INFUSE HANDOFF marker block. `apiClient.markPlayed` is
a stable upstream SDK method (used by upstream's
`emby-playstatebutton`, `userdatabuttons`, etc.). If upstream
ever changes how external-player playback is reported back to
the server, drop our marker block and use theirs.

## Why `rfc3986Encode` (not `encodeURIComponent`)

`make-infuse-url.sh` uses `jq @uri` which encodes every char
outside RFC 3986 unreserved [A-Za-z0-9-._~]. JavaScript's
`encodeURIComponent` leaves `! * ' ( )` un-encoded. For most
items this doesn't matter (TMDB-decodes either form to the same
string), but for any title with an apostrophe the URLs differ
byte-for-byte — violating the "Play button produces identical
URL to the reference shell" hard rule.

`rfc3986Encode` is a one-line fix: run `encodeURIComponent`,
then percent-encode the five chars it leaves behind. The unit
test in `infuseUrl.test.js` locks this in with a `Bob's
Burgers` fixture.

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
- **Lint clean** on all patched files (1 pre-existing warning
  on `playbackmanager.js:~2635` unrelated to us — a `// FIXME`
  comment upstream).
- **`build:check` (tsc --noEmit)** clean.
- **Unit tests green** — `npm test` passes 178 tests including
  11 new ones in `src/components/playback/infuseUrl.test.js`
  that lock in byte-identical output against `make-infuse-url.sh`
  for movie + episode fixtures (apostrophe case included).
- **Dev server boots clean** — `npm start` serves
  `<title>Media</title>`, manifest name `"Media (Homelab)"`, and
  the Infuse handoff string is present in the live dev bundle.
- **End-to-end verified on real hardware (2026-05-14):**
  - `make-infuse-url.sh` output played in Infuse on Mac. ✓
  - Same URL tap-tested on iPhone — Infuse opened and played,
    AirPlay Now Playing showed real episode metadata (not
    "Stream"). ✓
  - Fork dev server click-Play exercised: logged into Jellyfin
    via the Tailscale hostname, clicked Play on an item,
    Safari dispatched to `infuse://` URL, Infuse played. ✓
- **Not yet deployed.** Compose service scaffolded at
  `homelab/compose/jellyfin-web-custom/` but not yet built or
  run on the NAS. All blockers cleared; ready when you are.

## Gotcha: use the Tailscale hostname, not the LAN IP

When the Mac is off-LAN (coffee shop, hotspot, etc.), connecting
to Jellyfin at `http://192.168.1.151:8096` times out — that IP
isn't reachable from outside the house. Use the Tailscale
hostname instead:

```
http://jeff-nas.taild6c575.ts.net:8096
```

This works from anywhere Tailscale is connected — same Mac on
LAN, off-LAN, iPhone on cellular, etc. The fork's web client
stores whatever URL you enter at first-login in localStorage,
so prefer the Tailscale hostname for consistency across
networks. Same goes for the deployed PWA at
`http://jeff-nas.taild6c575.ts.net:8097`.

## Deploying changes

The canonical procedure (Mac-build, ship, NAS run with
`--no-build`) is wrapped by `scripts/homelab-deploy.sh`. Typical
iteration is just:

```bash
./scripts/homelab-deploy.sh
```

That runs lint + typecheck → `git push origin <branch>` →
`docker buildx build --platform linux/amd64` on the Mac →
`docker save | ssh ... docker load` to ship to the NAS →
`docker compose up -d --no-build` to restart the service →
verifies HTTP 200 and prints `.buildinfo`.

Useful flags (run `./scripts/homelab-deploy.sh --help` for the
full list):

- `--skip-checks` — skip lint/typecheck (faster mid-iteration).
- `--skip-push` — deploy an already-pushed commit; useful for
  redeploys or for testing a teammate's branch.
- `--copy-compose` — also `scp` the compose folder up; only
  needed when `Dockerfile`, `docker-compose.yml`, or
  `nginx.conf` have changed in the homelab repo.
- `--ref <sha-or-tag>` — pin the in-image git checkout to a
  specific ref instead of `master`.

The script enforces the never-build-on-NAS rule by always
passing `--platform linux/amd64` to the Mac build and
`--no-build` to the NAS-side compose up. If those flags fail,
something has drifted; **don't** work around it on the NAS.

## Pull-to-refresh (iOS standalone PWA)

iOS strips Safari's native pull-to-refresh gesture when the app
is launched from the home screen (`navigator.standalone === true`).
This adds it back. Wrapped in
`=====HOMELAB PULL TO REFRESH=====` markers in two places:

- **`src/components/pullToRefresh/pullToRefresh.ts`** — new
  module. Listens for vertical pulls at the top of the document
  (`scrollY === 0`), draws a small circular indicator that
  tracks the pull, and calls `window.location.reload()` when the
  user releases past a 70px (damped) threshold. Module self-
  gates on `browser.iOS && navigator.standalone`, so it's a
  no-op everywhere else. Horizontal swipes on rows can't
  accidentally trigger it because activation requires
  `|deltaY| > |deltaX|`.
- **`src/index.jsx`** — `loadPlatformFeatures()` dynamically
  imports the module on iOS. The module's own self-gate handles
  the standalone-vs-Safari distinction at runtime so a user who
  opens the URL in iOS Safari directly (not from the home-screen
  icon) gets Safari's native pull-to-refresh instead of ours.

Visual indicator is inline-styled (no separate SCSS file) and
uses the unicode refresh glyph (↻) so it doesn't depend on any
icon font being loaded. Honors `env(safe-area-inset-top)` so it
doesn't appear under the dynamic island / notch.

## Row swipe containment (iOS Safari)

Single-line CSS patch in `src/styles/scrollstyles.scss` inside a
`=====HOMELAB ROW SCROLL=====` marker block. Adds
`overscroll-behavior-x: contain` to `.scrollX` (the class
Jellyfin's row scroller applies to horizontal sliders like
"Continue Watching", "Next Up", "Recently Added", etc.).

Why: on iPad/iPhone Safari, swiping left on a row would
sometimes "chain" the gesture out to an ancestor container and
make the whole page feel like it was panning around. Stock
Jellyfin behavior, not something the fork broke — just papercut
UX that's free to fix here. `contain` stops the overscroll
chain at the row boundary; vertical page scrolling still works
because the rule is axis-scoped to `-x`.

Applies to every horizontal scroller on the site (libraries,
favorites, search, etc.), not just the home page. Same root
cause, same fix everywhere.

## Dev Notes (admin dashboard, fork-only feature)

A small in-app scratchpad for capturing "things to build / fix /
improve" without leaving the Jellyfin UI. Lives in the admin
dashboard at `/dashboard/devnotes` with a sidebar entry under a
new "Homelab" section.

Why this exists: Jeff wanted somewhere to jot quick dev ideas
mid-flow while using the homelab. localStorage-only would have
been fastest, but cross-device sync (Mac, iPad, iPhone, dev box)
was the actual ask.

Persistence: Jellyfin's user `DisplayPreferences` API. Each note
is `{ id, title, body, createdAt, updatedAt }`; the array is
JSON-stringified into `CustomPrefs.notes` of a per-user pref
record keyed by `displayPreferencesId="homelab-devnotes"` and
`client="homelab-fork"`. Saves automatically on field blur.
Last-write-wins across devices (acceptable for single-user dev
notes; failure mode would be losing one device's edits, not
corruption).

Files (all marked with `=====BEGIN HOMELAB DEV NOTES=====` /
`=====END HOMELAB DEV NOTES=====` for rebase ergonomics):

- **`src/apps/dashboard/routes/devnotes/index.tsx`** — new
  fork-only file. The page itself (list + add/edit/delete +
  autosave). Uses `useApi`, `getDisplayPreferencesApi`, and the
  same react-query patterns as the existing dashboard pages
  (`activity`, `settings`).
- **`src/apps/dashboard/components/drawer/sections/HomelabDrawerSection.tsx`**
  — new fork-only file. Sidebar section with one entry (Dev
  Notes). Kept in its own file so the upstream `AppDrawer.tsx`
  edit is just one import + one render line, both inside marker
  blocks.
- **`src/apps/dashboard/routes/_asyncRoutes.ts`** — registers
  `'devnotes'` in the dashboard async route table.
- **`src/apps/dashboard/components/drawer/AppDrawer.tsx`** —
  imports and renders `HomelabDrawerSection` after the existing
  upstream sections.

Rebase risk: low and additive. The two upstream files we touch
(`_asyncRoutes.ts`, `AppDrawer.tsx`) are stable structurally;
edits live entirely inside marker blocks; the heavy lifting is
in fork-only files upstream never touches. If a future upstream
rebase conflicts on either file, the fix is mechanical.

Failure modes worth knowing:

- If the Jellyfin server is down, the page won't load — same as
  the rest of the dashboard.
- If a save fails (network blip, server restart), the page shows
  an error banner; the edit stays in component state and any
  further edit retries the save. Worst case: edit lost on page
  reload.
- Notes ride along with Jellyfin's DB (which you snapshot via
  Synology). No separate backup needed.

## Branch / commit hygiene

For v1, working directly on `master` is fine (single-user
single-purpose fork). When the v2+ feature work starts, switch
to feature branches with the `homelab/<feature>` naming
convention so upstream-rebase mechanics stay clean.
