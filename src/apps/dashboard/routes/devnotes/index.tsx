// =====BEGIN HOMELAB DEV NOTES=====
// Dashboard-only admin page for capturing quick "to build / fix /
// improve" notes. Persists across devices via Jellyfin's
// DisplayPreferences API (one CustomPrefs blob keyed by user, ID
// `homelab-devnotes`, client `homelab-fork`). Pure fork-only file
// — no upstream code is modified inside this component. The
// wiring (sidebar entry + async route table) touches upstream
// files and is delimited there with the same HOMELAB DEV NOTES
// marker token. See HOMELAB_FORK_NOTES.md.
import Add from '@mui/icons-material/Add';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { getDisplayPreferencesApi } from '@jellyfin/sdk/lib/utils/api/display-preferences-api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import Loading from 'components/loading/LoadingComponent';
import Page from 'components/Page';
import { useApi } from 'hooks/useApi';

const DISPLAY_PREFERENCES_ID = 'homelab-devnotes';
const CLIENT = 'homelab-fork';
const NOTES_KEY = 'notes';

interface DevNote {
    id: string;
    title: string;
    body: string;
    createdAt: number;
    updatedAt: number;
}

const newId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // Defensive fallback for ancient browsers without crypto.randomUUID.
    // Note IDs are local-collision tokens, not security material.
    // eslint-disable-next-line sonarjs/pseudo-random
    return `n_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const parseNotes = (raw?: string | null): DevNote[] => {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((n: unknown): n is DevNote => {
                if (!n || typeof n !== 'object') return false;
                const note = n as Record<string, unknown>;
                return typeof note.id === 'string'
                    && typeof note.title === 'string'
                    && typeof note.body === 'string'
                    && typeof note.createdAt === 'number'
                    && typeof note.updatedAt === 'number';
            });
    } catch {
        return [];
    }
};

const sortNotes = (notes: DevNote[]) =>
    [ ...notes ].sort((a, b) => b.updatedAt - a.updatedAt);

const formatTimestamp = (ts: number) => {
    try {
        return new Date(ts).toLocaleString();
    } catch {
        return '';
    }
};

export const Component = () => {
    const { api, user } = useApi();
    const queryClient = useQueryClient();
    const userId = user?.Id;

    const queryKey = useMemo(
        () => [ 'User', userId, 'DisplayPreferences', DISPLAY_PREFERENCES_ID, CLIENT ],
        [ userId ]
    );

    const { data: prefs, isPending, isError } = useQuery({
        queryKey,
        enabled: !!api && !!userId,
        queryFn: async ({ signal }) => {
            if (!api || !userId) throw new Error('Not ready');
            const res = await getDisplayPreferencesApi(api).getDisplayPreferences(
                { displayPreferencesId: DISPLAY_PREFERENCES_ID, userId, client: CLIENT },
                { signal }
            );
            return res.data;
        }
    });

    const [ notes, setNotes ] = useState<DevNote[]>([]);
    const [ hasHydrated, setHasHydrated ] = useState(false);

    useEffect(() => {
        if (prefs && !hasHydrated) {
            setNotes(parseNotes(prefs.CustomPrefs?.[NOTES_KEY]));
            setHasHydrated(true);
        }
    }, [ prefs, hasHydrated ]);

    const saveMutation = useMutation({
        mutationFn: async (next: DevNote[]) => {
            if (!api || !userId) throw new Error('Not ready');
            const base = prefs ?? { Id: DISPLAY_PREFERENCES_ID, CustomPrefs: {} };
            const updated = {
                ...base,
                Id: DISPLAY_PREFERENCES_ID,
                CustomPrefs: {
                    ...(base.CustomPrefs ?? {}),
                    [NOTES_KEY]: JSON.stringify(next)
                }
            };
            await getDisplayPreferencesApi(api).updateDisplayPreferences({
                displayPreferencesId: DISPLAY_PREFERENCES_ID,
                userId,
                client: CLIENT,
                displayPreferencesDto: updated
            });
            return updated;
        },
        onSuccess: (updated) => {
            queryClient.setQueryData(queryKey, updated);
        }
    });

    const persist = useCallback((next: DevNote[]) => {
        setNotes(next);
        saveMutation.mutate(next);
    }, [ saveMutation ]);

    const onAdd = useCallback(() => {
        const now = Date.now();
        const note: DevNote = {
            id: newId(),
            title: '',
            body: '',
            createdAt: now,
            updatedAt: now
        };
        persist([ note, ...notes ]);
    }, [ notes, persist ]);

    const onUpdate = useCallback((id: string, patch: Partial<Pick<DevNote, 'title' | 'body'>>) => {
        const next = notes.map(n =>
            n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n
        );
        persist(next);
    }, [ notes, persist ]);

    const onDelete = useCallback((id: string) => {
        if (!window.confirm('Delete this note?')) return;
        persist(notes.filter(n => n.id !== id));
    }, [ notes, persist ]);

    if (isPending) return <Loading />;

    const sorted = sortNotes(notes);
    let status = '';
    if (saveMutation.isPending) status = 'Saving…';
    else if (saveMutation.isError) status = 'Save failed';
    else if (saveMutation.isSuccess) status = 'Saved';

    return (
        <Page
            id='homelabDevNotesPage'
            title='Dev Notes'
            className='type-interior mainAnimatedPage'
        >
            <Box className='content-primary'>
                <Stack spacing={3}>
                    <Stack direction='row' alignItems='center' spacing={2}>
                        <Typography variant='h1' sx={{ flexGrow: 1 }}>
                            Dev Notes
                        </Typography>
                        <Typography
                            variant='caption'
                            sx={{ color: 'text.secondary', minWidth: '5em', textAlign: 'right' }}
                        >
                            {status}
                        </Typography>
                        <Button variant='contained' startIcon={<Add />} onClick={onAdd}>
                            New note
                        </Button>
                    </Stack>

                    <Typography variant='body2' sx={{ color: 'text.secondary' }}>
                        Quick capture for things to build, fix, or improve in the homelab.
                        Notes sync across devices via your Jellyfin user profile and save
                        automatically when you click out of a field.
                    </Typography>

                    {isError && (
                        <Alert severity='warning'>
                            Could not load existing notes. New edits will still try to save.
                        </Alert>
                    )}

                    {saveMutation.isError && (
                        <Alert severity='error'>
                            Last save failed. Your edits are still in this page; try editing again to retry.
                        </Alert>
                    )}

                    {sorted.length === 0 ? (
                        <Card variant='outlined'>
                            <CardContent>
                                <Typography color='text.secondary'>
                                    No notes yet. Click <strong>New note</strong> to add one.
                                </Typography>
                            </CardContent>
                        </Card>
                    ) : (
                        <Stack spacing={2}>
                            {sorted.map(note => (
                                <NoteCard
                                    key={note.id}
                                    note={note}
                                    onChange={onUpdate}
                                    onDelete={onDelete}
                                />
                            ))}
                        </Stack>
                    )}
                </Stack>
            </Box>
        </Page>
    );
};

interface NoteCardProps {
    note: DevNote;
    onChange: (id: string, patch: Partial<Pick<DevNote, 'title' | 'body'>>) => void;
    onDelete: (id: string) => void;
}

const NoteCard = ({ note, onChange, onDelete }: NoteCardProps) => {
    const [ title, setTitle ] = useState(note.title);
    const [ body, setBody ] = useState(note.body);

    useEffect(() => {
        setTitle(note.title);
    }, [ note.title ]);

    useEffect(() => {
        setBody(note.body);
    }, [ note.body ]);

    const onTitleBlur = useCallback(() => {
        if (title !== note.title) onChange(note.id, { title });
    }, [ title, note.id, note.title, onChange ]);

    const onBodyBlur = useCallback(() => {
        if (body !== note.body) onChange(note.id, { body });
    }, [ body, note.id, note.body, onChange ]);

    const onTitleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            setTitle(e.target.value);
        },
        []
    );

    const onBodyChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            setBody(e.target.value);
        },
        []
    );

    const onDeleteClick = useCallback(() => onDelete(note.id), [ onDelete, note.id ]);

    return (
        <Card variant='outlined'>
            <CardContent>
                <Stack spacing={1.5}>
                    <Stack direction='row' alignItems='center' spacing={1}>
                        <TextField
                            placeholder='Title'
                            value={title}
                            onChange={onTitleChange}
                            onBlur={onTitleBlur}
                            variant='standard'
                            slotProps={{
                                input: {
                                    sx: { fontSize: '1.15rem', fontWeight: 500 }
                                }
                            }}
                            sx={{ flexGrow: 1 }}
                        />
                        <Typography
                            variant='caption'
                            sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}
                        >
                            {formatTimestamp(note.updatedAt)}
                        </Typography>
                        <IconButton
                            aria-label='Delete note'
                            onClick={onDeleteClick}
                            size='small'
                        >
                            <DeleteOutline fontSize='small' />
                        </IconButton>
                    </Stack>
                    <TextField
                        placeholder='Note…'
                        value={body}
                        onChange={onBodyChange}
                        onBlur={onBodyBlur}
                        multiline
                        minRows={3}
                        fullWidth
                    />
                </Stack>
            </CardContent>
        </Card>
    );
};

Component.displayName = 'HomelabDevNotesPage';
// =====END HOMELAB DEV NOTES=====
