import Stack from '@mui/material/Stack';
import React, { type FC } from 'react';
import { useLocation } from 'react-router-dom';

import { appRouter, PUBLIC_PATHS } from 'components/router/appRouter';
import AppToolbar from 'components/toolbar/AppToolbar';
import ServerButton from 'components/toolbar/ServerButton';

import RemotePlayButton from './RemotePlayButton';
import SyncPlayButton from './SyncPlayButton';
import SearchButton from './SearchButton';
import UserViewNav from './userViews/UserViewNav';

interface AppToolbarProps {
    isDrawerAvailable: boolean
    isDrawerOpen: boolean
    onDrawerButtonClick: (event: React.MouseEvent<HTMLElement>) => void
}

const ExperimentalAppToolbar: FC<AppToolbarProps> = ({
    isDrawerAvailable,
    isDrawerOpen,
    onDrawerButtonClick
}) => {
    const location = useLocation();

    // The video osd does not show the standard toolbar
    if (location.pathname === '/video') return null;

    // =====BEGIN HOMELAB BACK BUTTON=====
    // Upstream gates the back button on `window.NativeShell` so it only appears
    // inside the Jellyfin Media Player desktop wrappers. We use this fork from
    // a plain browser (Safari on Mac/iPad), where drilling into a library item
    // and then trying to navigate back is the most common UI complaint.
    // Drop the NativeShell gate so the button appears whenever there's actually
    // somewhere to go back to (`appRouter.canGoBack` already does the right
    // thing — returns false on START_PAGE_PATHS like /home).
    const isBackButtonAvailable = appRouter.canGoBack(location.pathname);
    // =====END HOMELAB BACK BUTTON=====

    // Check if the current path is a public path to hide user content
    const isPublicPath = PUBLIC_PATHS.includes(location.pathname);

    return (
        <AppToolbar
            buttons={!isPublicPath && (
                <>
                    <SyncPlayButton />
                    <RemotePlayButton />
                    <SearchButton />
                </>
            )}
            isDrawerAvailable={isDrawerAvailable}
            isDrawerOpen={isDrawerOpen}
            onDrawerButtonClick={onDrawerButtonClick}
            isBackButtonAvailable={isBackButtonAvailable}
            isUserMenuAvailable={!isPublicPath}
        >
            {!isDrawerAvailable && (
                <Stack
                    direction='row'
                    spacing={0.5}
                >
                    <ServerButton />

                    {!isPublicPath && (
                        <UserViewNav />
                    )}
                </Stack>
            )}
        </AppToolbar>
    );
};

export default ExperimentalAppToolbar;
