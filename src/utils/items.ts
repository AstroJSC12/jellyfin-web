import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order';
import * as userSettings from 'scripts/settings/userSettings';
import layoutManager from 'components/layoutManager';
import { EpisodeFilter, FeatureFilters, LibraryViewSettings, ParentId, VideoBasicFilter, ViewMode } from '../types/library';
import { LibraryTab } from 'types/libraryTab';
import type { AttributesOpts, DataAttributes } from 'types/dataAttributes';

export const getVideoBasicFilter = (libraryViewSettings: LibraryViewSettings) => {
    let isHd;

    if (libraryViewSettings.Filters?.VideoBasicFilter?.includes(VideoBasicFilter.IsHD)) {
        isHd = true;
    }

    if (libraryViewSettings.Filters?.VideoBasicFilter?.includes(VideoBasicFilter.IsSD)) {
        isHd = false;
    }

    return {
        isHd,
        is4K: libraryViewSettings.Filters?.VideoBasicFilter?.includes(VideoBasicFilter.Is4K) ?
            true :
            undefined,
        is3D: libraryViewSettings.Filters?.VideoBasicFilter?.includes(VideoBasicFilter.Is3D) ?
            true :
            undefined
    };
};

export const getFeatureFilters = (libraryViewSettings: LibraryViewSettings) => {
    return {
        hasSubtitles: libraryViewSettings.Filters?.Features?.includes(FeatureFilters.HasSubtitles) ?
            true :
            undefined,
        hasTrailer: libraryViewSettings.Filters?.Features?.includes(FeatureFilters.HasTrailer) ?
            true :
            undefined,
        hasSpecialFeature: libraryViewSettings.Filters?.Features?.includes(
            FeatureFilters.HasSpecialFeature
        ) ?
            true :
            undefined,
        hasThemeSong: libraryViewSettings.Filters?.Features?.includes(FeatureFilters.HasThemeSong) ?
            true :
            undefined,
        hasThemeVideo: libraryViewSettings.Filters?.Features?.includes(
            FeatureFilters.HasThemeVideo
        ) ?
            true :
            undefined
    };
};

export const getEpisodeFilter = (
    viewType: LibraryTab,
    libraryViewSettings: LibraryViewSettings
) => {
    return {
        parentIndexNumber: libraryViewSettings.Filters?.EpisodeFilter?.includes(
            EpisodeFilter.ParentIndexNumber
        ) ?
            0 :
            undefined,
        isMissing:
            viewType === LibraryTab.Episodes ?
                !!libraryViewSettings.Filters?.EpisodeFilter?.includes(EpisodeFilter.IsMissing) :
                undefined,
        isUnaired: libraryViewSettings.Filters?.EpisodeFilter?.includes(EpisodeFilter.IsUnaired) ?
            true :
            undefined
    };
};

const getItemFieldsEnum = (
    viewType: LibraryTab,
    libraryViewSettings: LibraryViewSettings
) => {
    const itemFields: ItemFields[] = [];

    if (viewType !== LibraryTab.Networks) {
        itemFields.push(ItemFields.MediaSourceCount);
    }

    if (libraryViewSettings.ImageType === ImageType.Primary) {
        itemFields.push(ItemFields.PrimaryImageAspectRatio);
    }

    if (viewType === LibraryTab.Networks) {
        itemFields.push(
            ItemFields.DateCreated,
            ItemFields.PrimaryImageAspectRatio
        );
    }

    return itemFields;
};

export const getFieldsQuery = (
    viewType: LibraryTab,
    libraryViewSettings: LibraryViewSettings
) => {
    return {
        fields: getItemFieldsEnum(viewType, libraryViewSettings)
    };
};

export const getLimitQuery = () => {
    return {
        limit: userSettings.libraryPageSize(undefined) || undefined
    };
};

export const getAlphaPickerQuery = (libraryViewSettings: LibraryViewSettings) => {
    const alphabetValue = libraryViewSettings.Alphabet !== null ?
        libraryViewSettings.Alphabet : undefined;

    return {
        nameLessThan: alphabetValue === '#' ? 'A' : undefined,
        nameStartsWith: alphabetValue === '#' ? undefined : alphabetValue
    };
};

export const getFiltersQuery = (
    viewType: LibraryTab,
    libraryViewSettings: LibraryViewSettings
) => {
    return {
        ...getFeatureFilters(libraryViewSettings),
        ...getEpisodeFilter(viewType, libraryViewSettings),
        ...getVideoBasicFilter(libraryViewSettings),
        seriesStatus: libraryViewSettings?.Filters?.SeriesStatus,
        videoTypes: libraryViewSettings?.Filters?.VideoTypes,
        filters: libraryViewSettings?.Filters?.Status,
        genres: libraryViewSettings?.Filters?.Genres,
        officialRatings: libraryViewSettings?.Filters?.OfficialRatings,
        tags: libraryViewSettings?.Filters?.Tags,
        years: libraryViewSettings?.Filters?.Years,
        studioIds: libraryViewSettings?.Filters?.StudioIds
    };
};

// =====BEGIN HOMELAB IMDB SORT=====
// Views where we default-sort by IMDb rating descending instead of
// the upstream "Name ascending." Tracks Jeff's stated preference
// (mirrors Infuse's "Sort by Rating" behavior on iOS) and surfaces
// the highest-rated content without the user having to discover the
// sort menu.
//
// CommunityRating is the Jellyfin field name; OMDb plugin populates
// it with IMDb's 0–10 score. Verified populating correctly on Jeff's
// Jellyfin as of 2026-05-10. See ROADMAP.md Symptom B for the
// server-side audit trail.
//
// Keeping this list short and movie/show-flavored on purpose; music,
// photos, books etc. keep the upstream alphabetical default since
// their rating fields are mostly empty.
const HOMELAB_IMDB_SORT_VIEWS = new Set<LibraryTab>([
    LibraryTab.Movies,
    LibraryTab.Series,
    LibraryTab.Favorites,
    LibraryTab.Collections,
    LibraryTab.Mixed
]);
// =====END HOMELAB IMDB SORT=====

export const getSettingsKey = (viewType: LibraryTab, parentId: ParentId) => {
    // =====BEGIN HOMELAB IMDB SORT=====
    // Bumped suffix from upstream "${viewType} - ${parentId}" so that
    // existing localStorage entries (which were seeded with the old
    // SortName/Ascending defaults before this fork shipped IMDb sort)
    // are ignored on first load. Without this bump, Jeff's iPhone PWA
    // would silently keep the stale settings and never see the new
    // default. Each minor bump invalidates one round of cached prefs;
    // OK because users can re-apply any custom sort they had set.
    return `${viewType} - ${parentId} - homelab.v1`;
    // =====END HOMELAB IMDB SORT=====
};

export const getDefaultSortBy = (viewType: LibraryTab) => {
    // =====BEGIN HOMELAB IMDB SORT=====
    if (HOMELAB_IMDB_SORT_VIEWS.has(viewType)) {
        return ItemSortBy.CommunityRating;
    }
    // =====END HOMELAB IMDB SORT=====

    if (viewType === LibraryTab.Episodes) {
        return ItemSortBy.SeriesSortName;
    }

    return ItemSortBy.SortName;
};

export const getDefaultLibraryViewSettings = (viewType: LibraryTab): LibraryViewSettings => {
    return {
        ShowTitle: true,
        ShowYear: true,
        ViewMode: viewType === LibraryTab.Songs ? ViewMode.ListView : ViewMode.GridView,
        ImageType: viewType === LibraryTab.Networks ? ImageType.Thumb : ImageType.Primary,
        CardLayout: false,
        SortBy: getDefaultSortBy(viewType),
        // =====BEGIN HOMELAB IMDB SORT=====
        // Highest IMDb rating first when this view defaults to
        // CommunityRating; everything else stays Ascending per
        // upstream.
        SortOrder: HOMELAB_IMDB_SORT_VIEWS.has(viewType) ? SortOrder.Descending : SortOrder.Ascending,
        // =====END HOMELAB IMDB SORT=====
        StartIndex: 0
    };
};

export function getDataAttributes(
    opts: AttributesOpts
): DataAttributes {
    return {
        'data-context': opts.context,
        'data-collectionid': opts.collectionId,
        'data-playlistid': opts.playlistId,
        'data-parentid': opts.parentId,
        'data-playlistitemid': opts.itemPlaylistItemId,
        'data-action': layoutManager.tv ? opts.action : null,
        'data-serverid': opts.itemServerId,
        'data-id': opts.itemId,
        'data-timerid': opts.itemTimerId,
        'data-seriestimerid': opts.itemSeriesTimerId,
        'data-channelid': opts.itemChannelId,
        'data-type': opts.itemType,
        'data-mediatype': opts.itemMediaType,
        'data-collectiontype': opts.itemCollectionType,
        'data-isfolder': opts.itemIsFolder,
        'data-path': opts.itemPath,
        'data-prefix': opts.prefix,
        'data-positionticks': opts.itemUserData?.PlaybackPositionTicks,
        'data-startdate': opts.itemStartDate?.toString(),
        'data-enddate': opts.itemEndDate?.toString()
    };
}

