// =====BEGIN HOMELAB INFUSE HANDOFF=====
/* eslint-disable sonarjs/no-clear-text-protocols --
   The homelab's Jellyfin is exposed as http:// over Tailscale (TLS at
   the tailnet layer, not at the Jellyfin endpoint). Test fixtures
   match the real URL shape used in production. */
// Regression tests for the Infuse URL builder. Each expected URL
// here is byte-identical to what `make-infuse-url.sh` (the canonical
// reference implementation in ~/Projects/homelab/scripts/) would
// emit for the same Jellyfin item. The encoded substrings were
// generated with `jq -sRr @uri`; if you change either side of the
// contract, regenerate the fixtures and confirm both surfaces still
// agree.
//
// See: ~/Projects/homelab/docs/INFUSE_URL_SCHEME.md

import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { MediaType } from '@jellyfin/sdk/lib/generated-client/models/media-type';
import { describe, expect, it } from 'vitest';

import { buildInfuseFilename, buildInfuseUrl, rfc3986Encode } from './infuseUrl';

const ctx = {
    serverUrl: 'http://192.168.1.151:8096',
    accessToken: 'tok123'
};

describe('rfc3986Encode', () => {
    it('matches jq @uri for unreserved-only set', () => {
        // jq @uri leaves only [A-Za-z0-9-._~] untouched. encodeURIComponent
        // additionally leaves !*'() alone — those are the ones we fix up.
        expect(rfc3986Encode("Bob's Burgers")).toBe('Bob%27s%20Burgers');
        expect(rfc3986Encode('M*A*S*H')).toBe('M%2AA%2AS%2AH');
        expect(rfc3986Encode('!*\'()')).toBe('%21%2A%27%28%29');
        // Unreserved chars stay raw.
        expect(rfc3986Encode('-._~')).toBe('-._~');
    });
});

describe('buildInfuseFilename', () => {
    it('builds scene-style episode filename without zero-padding', () => {
        const item = {
            Type: BaseItemKind.Episode,
            SeriesName: 'The Big Bang Theory',
            ParentIndexNumber: 1,
            IndexNumber: 1,
            Name: 'Pilot'
        };
        expect(buildInfuseFilename(item)).toBe('The Big Bang Theory.S1E1.Pilot.mp4');
    });

    it('builds movie filename with year', () => {
        const item = {
            Type: BaseItemKind.Movie,
            Name: 'Inception',
            ProductionYear: 2010
        };
        expect(buildInfuseFilename(item)).toBe('Inception.2010.mp4');
    });

    it('builds movie filename without year', () => {
        const item = { Type: BaseItemKind.Movie, Name: 'Untitled' };
        expect(buildInfuseFilename(item)).toBe('Untitled.mp4');
    });

    it('returns null for episodes missing required metadata', () => {
        // ParentIndexNumber missing
        expect(buildInfuseFilename({
            Type: BaseItemKind.Episode,
            SeriesName: 'Show', IndexNumber: 1, Name: 'Ep'
        })).toBeNull();
        // SeriesName missing
        expect(buildInfuseFilename({
            Type: BaseItemKind.Episode,
            ParentIndexNumber: 1, IndexNumber: 1, Name: 'Ep'
        })).toBeNull();
    });

    it('returns null for non-video / unknown types (fork falls back to in-browser)', () => {
        // Deliberate divergence from make-infuse-url.sh, which falls
        // back to `${Name}.mp4` for other types. In the PWA we'd rather
        // skip the handoff than guess wrong.
        expect(buildInfuseFilename({ Type: BaseItemKind.Trailer, Name: 'X' })).toBeNull();
        expect(buildInfuseFilename({ Type: BaseItemKind.MusicVideo, Name: 'X' })).toBeNull();
        expect(buildInfuseFilename(null)).toBeNull();
    });
});

describe('buildInfuseUrl', () => {
    it('produces byte-identical output to make-infuse-url.sh for a movie', () => {
        const item = {
            Id: 'abc123',
            ServerId: 'srv',
            Type: BaseItemKind.Movie,
            MediaType: MediaType.Video,
            Name: 'Inception',
            ProductionYear: 2010
        };
        // Expected stream URL portion (single jq @uri pass over the
        // raw stream URL): jq -sRr @uri on
        // http://192.168.1.151:8096/Videos/abc123/stream?static=true&api_key=tok123&MediaSourceId=abc123
        const expected =
            'infuse://x-callback-url/play'
            + '?url=http%3A%2F%2F192.168.1.151%3A8096%2FVideos%2Fabc123%2Fstream'
            + '%3Fstatic%3Dtrue%26api_key%3Dtok123%26MediaSourceId%3Dabc123'
            + '&filename=Inception.2010.mp4';
        expect(buildInfuseUrl(item, ctx)).toBe(expected);
    });

    it('produces byte-identical output for an episode with an apostrophe', () => {
        const item = {
            Id: 'ep01',
            ServerId: 'srv',
            Type: BaseItemKind.Episode,
            MediaType: MediaType.Video,
            SeriesName: "Bob's Burgers",
            ParentIndexNumber: 1,
            IndexNumber: 1,
            Name: 'Human Flesh'
        };
        // The apostrophe is the canonical "encodeURIComponent vs
        // jq @uri" divergence point. Expected: '%27', not literal '.
        const expected =
            'infuse://x-callback-url/play'
            + '?url=http%3A%2F%2F192.168.1.151%3A8096%2FVideos%2Fep01%2Fstream'
            + '%3Fstatic%3Dtrue%26api_key%3Dtok123%26MediaSourceId%3Dep01'
            + '&filename=Bob%27s%20Burgers.S1E1.Human%20Flesh.mp4';
        expect(buildInfuseUrl(item, ctx)).toBe(expected);
    });

    it('returns null for audio items (handoff is video-only)', () => {
        const item = {
            Id: 'song01',
            ServerId: 'srv',
            Type: BaseItemKind.Audio,
            MediaType: MediaType.Audio,
            Name: 'Track'
        };
        expect(buildInfuseUrl(item, ctx)).toBeNull();
    });

    it('returns null when server context is incomplete', () => {
        const item = {
            Id: 'abc',
            ServerId: 'srv',
            Type: BaseItemKind.Movie,
            MediaType: MediaType.Video,
            Name: 'X',
            ProductionYear: 2020
        };
        expect(buildInfuseUrl(item, { serverUrl: '', accessToken: 'tok' })).toBeNull();
        expect(buildInfuseUrl(item, { serverUrl: 'http://h', accessToken: '' })).toBeNull();
        expect(buildInfuseUrl(item, {})).toBeNull();
    });

    it('returns null when the item record is missing or has no id', () => {
        expect(buildInfuseUrl(null, ctx)).toBeNull();
        expect(buildInfuseUrl({
            Type: BaseItemKind.Movie,
            MediaType: MediaType.Video,
            Name: 'X', ProductionYear: 2020
        }, ctx)).toBeNull();
    });
});
/* eslint-enable sonarjs/no-clear-text-protocols */
// =====END HOMELAB INFUSE HANDOFF=====
