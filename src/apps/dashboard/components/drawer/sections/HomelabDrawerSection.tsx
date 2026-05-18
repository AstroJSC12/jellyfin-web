// =====BEGIN HOMELAB DEV NOTES=====
// Sidebar entry for the homelab fork's Dev Notes page. Lives in
// its own file so the upstream AppDrawer.tsx stays nearly clean
// (one import + one render line, both inside HOMELAB markers).
// See HOMELAB_FORK_NOTES.md.
import StickyNote2 from '@mui/icons-material/StickyNote2';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import React from 'react';

import ListItemLink from 'components/ListItemLink';

const HomelabDrawerSection = () => (
    <List
        aria-labelledby='homelab-subheader'
        subheader={
            <ListSubheader component='div' id='homelab-subheader'>
                Homelab
            </ListSubheader>
        }
    >
        <ListItem disablePadding>
            <ListItemLink to='/dashboard/devnotes'>
                <ListItemIcon>
                    <StickyNote2 />
                </ListItemIcon>
                <ListItemText primary='Dev Notes' />
            </ListItemLink>
        </ListItem>
    </List>
);

export default HomelabDrawerSection;
// =====END HOMELAB DEV NOTES=====
