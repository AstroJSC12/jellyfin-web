// =====BEGIN HOMELAB IMDB SORT=====
// Regression tests for the homelab-fork-only "default sort by IMDb
// rating descending" behavior. Locks in:
//
//   - the set of views that get the IMDb-rating default
//     (Movies, Series, Favorites, Collections, Mixed)
//   - the SortOrder paired with that default (Descending)
//   - the legacy upstream defaults still hold everywhere else
//     (Episodes → SeriesSortName, all other views → SortName)
//   - the localStorage key carries the "homelab.v1" suffix so that
//     existing PWA installs ignore their stale upstream-default
//     cached settings on first load after this ships.
//
// If upstream renames a LibraryTab enum value, expands the default
// sort logic, or changes the storage-key shape, these tests catch
// the conflict during rebase. Keep the assertions narrow and tied
// to the homelab feature so they don't fight legitimate upstream
// changes.
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order';
import { describe, expect, it, vi } from 'vitest';

// items.ts pulls in scripts/settings/userSettings and components/layoutManager
// at module load, which transitively boot apphost + globalize and crash in
// vitest's jsdom because the event-bus singletons aren't initialized. The
// three functions under test are pure (input → output, no userSettings /
// layoutManager calls), so stubbing those two modules out is the smallest
// change that unblocks the test without touching upstream code paths.
vi.mock('scripts/settings/userSettings', () => ({}));
vi.mock('components/layoutManager', () => ({ default: { mobile: false, tv: false } }));

import {
    getDefaultLibraryViewSettings,
    getDefaultSortBy,
    getSettingsKey
} from './items';
import { LibraryTab } from '../types/libraryTab';

describe('HOMELAB IMDB SORT — getDefaultSortBy', () => {
    it.each([
        LibraryTab.Movies,
        LibraryTab.Series,
        LibraryTab.Favorites,
        LibraryTab.Collections,
        LibraryTab.Mixed
    ])('defaults %s to CommunityRating', (viewType) => {
        expect(getDefaultSortBy(viewType)).toBe(ItemSortBy.CommunityRating);
    });

    it('keeps Episodes on SeriesSortName (upstream default)', () => {
        expect(getDefaultSortBy(LibraryTab.Episodes)).toBe(ItemSortBy.SeriesSortName);
    });

    it.each([
        LibraryTab.Albums,
        LibraryTab.Songs,
        LibraryTab.Books,
        LibraryTab.Playlists,
        LibraryTab.Photos
    ])('keeps %s on SortName (upstream default)', (viewType) => {
        expect(getDefaultSortBy(viewType)).toBe(ItemSortBy.SortName);
    });
});

describe('HOMELAB IMDB SORT — getDefaultLibraryViewSettings', () => {
    it.each([
        LibraryTab.Movies,
        LibraryTab.Series,
        LibraryTab.Favorites,
        LibraryTab.Collections,
        LibraryTab.Mixed
    ])('%s defaults to CommunityRating + Descending', (viewType) => {
        const settings = getDefaultLibraryViewSettings(viewType);
        expect(settings.SortBy).toBe(ItemSortBy.CommunityRating);
        expect(settings.SortOrder).toBe(SortOrder.Descending);
    });

    it('Episodes keeps SeriesSortName + Ascending', () => {
        const settings = getDefaultLibraryViewSettings(LibraryTab.Episodes);
        expect(settings.SortBy).toBe(ItemSortBy.SeriesSortName);
        expect(settings.SortOrder).toBe(SortOrder.Ascending);
    });

    it('Songs keeps SortName + Ascending', () => {
        const settings = getDefaultLibraryViewSettings(LibraryTab.Songs);
        expect(settings.SortBy).toBe(ItemSortBy.SortName);
        expect(settings.SortOrder).toBe(SortOrder.Ascending);
    });
});

describe('HOMELAB IMDB SORT — getSettingsKey', () => {
    it('includes the homelab.v1 suffix so existing stale settings are invalidated', () => {
        const key = getSettingsKey(LibraryTab.Movies, 'parent-id-abc');
        expect(key).toContain('homelab.v1');
        expect(key).toBe('movies - parent-id-abc - homelab.v1');
    });

    it('handles null parentId without crashing', () => {
        const key = getSettingsKey(LibraryTab.Favorites, null);
        expect(key).toBe('favorites - null - homelab.v1');
    });

    it('handles undefined parentId without crashing', () => {
        const key = getSettingsKey(LibraryTab.Series, undefined);
        expect(key).toBe('series - undefined - homelab.v1');
    });
});
// =====END HOMELAB IMDB SORT=====
