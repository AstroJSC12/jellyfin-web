// =====BEGIN HOMELAB INFUSE HANDOFF=====
// Pure URL builder for the Infuse x-callback-url/play deep-link.
// Lives in its own module so it can be unit-tested in isolation and
// so the fork-specific code is concentrated in files upstream
// doesn't touch (rebase ergonomics). The async item-resolution path
// (closure over PlaybackManager state, ServerConnections, etc.)
// stays in playbackmanager.js; this module is intentionally just the
// string-shape contract.
//
// Source-of-truth reference implementation:
//   ~/Projects/homelab/scripts/make-infuse-url.sh
// Spec:
//   ~/Projects/homelab/docs/INFUSE_URL_SCHEME.md
//
// Output for any given Jellyfin item must be byte-identical to what
// make-infuse-url.sh emits for the same item. The shell uses
// `jq @uri` which percent-encodes everything outside the RFC 3986
// unreserved set [A-Za-z0-9-._~]. JavaScript's encodeURIComponent
// leaves `!*'()` un-encoded, so we use rfc3986Encode below to match.

import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { MediaType } from '@jellyfin/sdk/lib/generated-client/models/media-type';

/**
 * Percent-encode `s` matching jq's `@uri` filter — i.e. encode every
 * character outside the RFC 3986 unreserved set [A-Za-z0-9-._~].
 * encodeURIComponent leaves `!*'()` alone; we fix that up here.
 *
 * @param {string} s
 * @returns {string}
 */
export function rfc3986Encode(s) {
    return encodeURIComponent(s).replace(
        /[!*'()]/g,
        (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
    );
}

/**
 * Build the scene-style filename hint Infuse uses for TMDB lookup.
 * Returns null when the item type doesn't have a defined convention
 * or required metadata is missing, so the caller can fall back to
 * the in-browser player rather than emit a half-baked URL.
 *
 * @param {object} item Jellyfin item record
 * @returns {string | null}
 */
export function buildInfuseFilename(item) {
    if (!item) return null;

    if (item.Type === BaseItemKind.Episode) {
        if (!item.SeriesName
                || item.ParentIndexNumber == null
                || item.IndexNumber == null
                || !item.Name) {
            return null;
        }
        return `${item.SeriesName}.S${item.ParentIndexNumber}E${item.IndexNumber}.${item.Name}.mp4`;
    }

    if (item.Type === BaseItemKind.Movie) {
        if (!item.Name) return null;
        return item.ProductionYear ?
            `${item.Name}.${item.ProductionYear}.mp4` :
            `${item.Name}.mp4`;
    }

    // Trailer, MusicVideo, generic Video, etc. — no verified scene-
    // style convention. The shell falls back to `${Name}.mp4`, but
    // for the PWA we'd rather fall through to the in-browser player
    // than emit a URL that might land on the wrong TMDB match. If a
    // convention gets verified for a content type, add it here.
    return null;
}

/**
 * Build the full `infuse://x-callback-url/play?url=…&filename=…` URL
 * for a Jellyfin video item. Returns null when the item isn't a
 * video, metadata is missing, or server context is incomplete.
 *
 * Must produce byte-identical output to make-infuse-url.sh for the
 * same item + same server context. See INFUSE_URL_SCHEME.md.
 *
 * @param {object} item Jellyfin item record
 * @param {object} ctx
 * @param {string} ctx.serverUrl Jellyfin base URL, e.g. http://host:8096
 * @param {string} ctx.accessToken Jellyfin API key / session token
 * @returns {string | null}
 */
export function buildInfuseUrl(item, { serverUrl, accessToken } = {}) {
    if (!item) return null;
    if (item.MediaType !== MediaType.Video) return null;
    if (!serverUrl || !accessToken || !item.Id) return null;

    const filename = buildInfuseFilename(item);
    if (!filename) return null;

    // Direct-stream URL. static=true tells Jellyfin to serve the
    // original file with no transcoding — Infuse direct-plays the
    // raw bytes. MediaSourceId echo mirrors the shell reference and
    // the existing working iOS Shortcut; Jellyfin is happy with it
    // present even though it's redundant for static=true.
    //
    // Built with raw substitution (no inner encoding), then the
    // whole string gets a single rfc3986Encode pass below. This
    // mirrors the shell exactly: build the URL with raw values,
    // then `jq @uri` once. Pre-encoding the token would double-
    // encode any reserved char and diverge from the shell.
    const streamUrl =
        `${serverUrl}/Videos/${item.Id}/stream`
        + '?static=true'
        + `&api_key=${accessToken}`
        + `&MediaSourceId=${item.Id}`;

    return 'infuse://x-callback-url/play'
        + `?url=${rfc3986Encode(streamUrl)}`
        + `&filename=${rfc3986Encode(filename)}`;
}
// =====END HOMELAB INFUSE HANDOFF=====
