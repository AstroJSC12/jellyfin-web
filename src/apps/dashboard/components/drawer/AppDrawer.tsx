import ListItem from '@mui/material/ListItem';
import List from '@mui/material/List';
import React, { FC } from 'react';

import DrawerHeaderLink from 'apps/experimental/components/drawers/DrawerHeaderLink';
import ResponsiveDrawer, { ResponsiveDrawerProps } from 'components/ResponsiveDrawer';

import ServerDrawerSection from './sections/ServerDrawerSection';
import DevicesDrawerSection from './sections/DevicesDrawerSection';
import LiveTvDrawerSection from './sections/LiveTvDrawerSection';
import AdvancedDrawerSection from './sections/AdvancedDrawerSection';
import PluginDrawerSection from './sections/PluginDrawerSection';
// =====BEGIN HOMELAB DEV NOTES=====
import HomelabDrawerSection from './sections/HomelabDrawerSection';
// =====END HOMELAB DEV NOTES=====

const AppDrawer: FC<ResponsiveDrawerProps> = ({
    open = false,
    onClose,
    onOpen
}) => (
    <ResponsiveDrawer
        open={open}
        onClose={onClose}
        onOpen={onOpen}
    >
        <List disablePadding>
            <ListItem disablePadding>
                <DrawerHeaderLink />
            </ListItem>
        </List>
        <ServerDrawerSection />
        <DevicesDrawerSection />
        <LiveTvDrawerSection />
        <PluginDrawerSection />
        <AdvancedDrawerSection />
        {/* =====BEGIN HOMELAB DEV NOTES===== */}
        <HomelabDrawerSection />
        {/* =====END HOMELAB DEV NOTES===== */}
    </ResponsiveDrawer>
);

export default AppDrawer;
