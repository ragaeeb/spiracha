import type { AntigravityConversation } from '@spiracha/lib/antigravity-exporter-types';
import type { AntigravityDecryptionState } from '@spiracha/lib/antigravity-keychain';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MouseEventHandler, ReactNode } from 'react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AntigravityConversationsTable } from './antigravity-conversations-table';

vi.mock('@tanstack/react-router', async () => {
    return {
        Link: ({
            children,
            params,
            to,
            ...props
        }: {
            children: ReactNode;
            params?: { conversationId?: string };
            to: string;
        }) => {
            const href = to.replace('$conversationId', encodeURIComponent(params?.conversationId ?? ''));
            return (
                <a href={href} {...props}>
                    {children}
                </a>
            );
        },
    };
});

vi.mock('#/components/ui/dropdown-menu', async () => {
    type DropdownMenuState = {
        open: boolean;
        setOpen: React.Dispatch<React.SetStateAction<boolean>>;
    };

    const DropdownMenuContext = React.createContext<DropdownMenuState | null>(null);

    const useDropdownMenuState = () => {
        const context = React.useContext(DropdownMenuContext);
        if (!context) {
            throw new Error('DropdownMenu mock requires a provider');
        }

        return context;
    };

    return {
        DropdownMenu: ({ children }: { children: ReactNode }) => {
            const [open, setOpen] = React.useState(false);
            return <DropdownMenuContext.Provider value={{ open, setOpen }}>{children}</DropdownMenuContext.Provider>;
        },
        DropdownMenuContent: ({ children }: { children: ReactNode }) => {
            const { open } = useDropdownMenuState();
            return open ? <div>{children}</div> : null;
        },
        DropdownMenuItem: ({
            children,
            disabled,
            onClick,
        }: {
            children: ReactNode;
            disabled?: boolean;
            onClick?: () => void;
        }) => {
            const { setOpen } = useDropdownMenuState();
            return (
                <button
                    disabled={disabled}
                    type="button"
                    onClick={() => {
                        onClick?.();
                        setOpen(false);
                    }}
                >
                    {children}
                </button>
            );
        },
        DropdownMenuTrigger: ({ children }: { children: ReactNode }) => {
            const { open, setOpen } = useDropdownMenuState();

            if (React.isValidElement(children)) {
                const child = children as React.ReactElement<{
                    onClick?: MouseEventHandler<HTMLButtonElement>;
                    'aria-expanded'?: boolean;
                    'aria-haspopup'?: string;
                }>;

                return React.cloneElement(child, {
                    'aria-expanded': open,
                    'aria-haspopup': 'menu',
                    onClick: (event) => {
                        child.props.onClick?.(event);
                        setOpen((current) => !current);
                    },
                });
            }

            return (
                <button
                    aria-expanded={open}
                    aria-haspopup="menu"
                    type="button"
                    onClick={() => setOpen((current) => !current)}
                >
                    {children}
                </button>
            );
        },
    };
});

const conversation: AntigravityConversation = {
    artifactBytes: 1024,
    artifactCount: 1,
    artifacts: [],
    conversationBytes: 4096,
    conversationId: 'conversation-1',
    conversationMtimeMs: 1_700_000_000_000,
    conversationPath: '/tmp/conversation.pb',
    createdAtMs: 1_700_000_000_000,
    indexedItemCount: 7,
    lastUpdatedAtMs: 1_700_000_100_000,
    model: null,
    projectId: null,
    sourceRoot: '/Users/user/.gemini/antigravity',
    summaryPath: '/tmp/summary.pb',
    title: 'Investigate flaky workspace sync',
    totalBytes: 7168,
    transcriptBytes: 2048,
    transcriptEntryCount: 12,
    transcriptPath: '/tmp/overview.txt',
    transcriptSource: 'overview',
    workspaceFolder: '/Users/user/workspace/demo',
    workspaceKey: 'folder:/Users/user/workspace/demo',
    workspaceLabel: 'demo',
    workspaceUri: 'file:///Users/user/workspace/demo',
};

const lockedState: AntigravityDecryptionState = {
    canRequestAccess: true,
    error: null,
    isUnlocked: false,
    keychainAccount: 'Antigravity Key',
    keychainService: 'Antigravity Safe Storage',
    platform: 'darwin',
    provider: 'keychain',
    status: 'locked',
};

const unlockedState: AntigravityDecryptionState = {
    ...lockedState,
    isUnlocked: true,
};

afterEach(() => {
    cleanup();
});

describe('AntigravityConversationsTable', () => {
    it('should render the conversation title as a real link for opening in a new tab', () => {
        render(
            <AntigravityConversationsTable
                conversations={[conversation]}
                decryptionState={lockedState}
                onDeleteConversation={vi.fn()}
                onDeleteConversations={vi.fn()}
                onExportArtifacts={vi.fn()}
                onExportConversation={vi.fn()}
                onExportConversations={vi.fn()}
            />,
        );

        const link = screen.getByRole('link', { name: /investigate flaky workspace sync/i });
        expect(link.getAttribute('href')).toBe('/antigravity-conversations/conversation-1');
        expect(screen.getByText('7.0 KB')).toBeTruthy();
    });

    it('should show a locked conversation export when only safe-storage content is available', async () => {
        render(
            <AntigravityConversationsTable
                conversations={[
                    {
                        ...conversation,
                        transcriptBytes: 0,
                        transcriptEntryCount: 0,
                        transcriptPath: null,
                        transcriptSource: 'safe-storage',
                    },
                ]}
                decryptionState={lockedState}
                onDeleteConversation={vi.fn()}
                onDeleteConversations={vi.fn()}
                onExportArtifacts={vi.fn()}
                onExportConversation={vi.fn()}
                onExportConversations={vi.fn()}
            />,
        );

        const menuTrigger = screen
            .getAllByRole('button')
            .find((button) => button.getAttribute('aria-haspopup') === 'menu');
        if (!menuTrigger) {
            throw new Error('expected a row action menu trigger');
        }

        fireEvent.click(menuTrigger);

        expect((await screen.findByText('Unlock conversation export first')).getAttribute('disabled')).not.toBeNull();
        expect(await screen.findByText('Export artifacts')).toBeTruthy();
    });

    it('should keep local-log transcript export available without keychain unlock', async () => {
        const onExportConversation = vi.fn();

        render(
            <AntigravityConversationsTable
                conversations={[conversation]}
                decryptionState={lockedState}
                onDeleteConversation={vi.fn()}
                onDeleteConversations={vi.fn()}
                onExportArtifacts={vi.fn()}
                onExportConversation={onExportConversation}
                onExportConversations={vi.fn()}
            />,
        );

        const menuTrigger = screen
            .getAllByRole('button')
            .find((button) => button.getAttribute('aria-haspopup') === 'menu');
        if (!menuTrigger) {
            throw new Error('expected a row action menu trigger');
        }

        fireEvent.click(menuTrigger);
        fireEvent.click(await screen.findByText('Export conversation'));

        expect(onExportConversation).toHaveBeenCalledWith(conversation);
    });

    it('should not offer a conversation export for artifact-only rows', async () => {
        render(
            <AntigravityConversationsTable
                conversations={[
                    {
                        ...conversation,
                        artifactCount: 1,
                        conversationPath: null,
                        transcriptBytes: 0,
                        transcriptEntryCount: 0,
                        transcriptPath: null,
                        transcriptSource: null,
                    },
                ]}
                decryptionState={unlockedState}
                onDeleteConversation={vi.fn()}
                onDeleteConversations={vi.fn()}
                onExportArtifacts={vi.fn()}
                onExportConversation={vi.fn()}
                onExportConversations={vi.fn()}
            />,
        );

        const menuTrigger = screen
            .getAllByRole('button')
            .find((button) => button.getAttribute('aria-haspopup') === 'menu');
        if (!menuTrigger) {
            throw new Error('expected a row action menu trigger');
        }

        fireEvent.click(menuTrigger);

        expect(screen.queryByText('Export conversation')).toBeNull();
        expect(await screen.findByText('Export artifacts')).toBeTruthy();
    });

    it('should trigger conversation and artifact exports when unlocked', async () => {
        const onExportArtifacts = vi.fn();
        const onExportConversation = vi.fn();

        render(
            <AntigravityConversationsTable
                conversations={[conversation]}
                decryptionState={unlockedState}
                onDeleteConversation={vi.fn()}
                onDeleteConversations={vi.fn()}
                onExportArtifacts={onExportArtifacts}
                onExportConversation={onExportConversation}
                onExportConversations={vi.fn()}
            />,
        );

        const menuTrigger = screen
            .getAllByRole('button')
            .find((button) => button.getAttribute('aria-haspopup') === 'menu');
        if (!menuTrigger) {
            throw new Error('expected a row action menu trigger');
        }

        fireEvent.click(menuTrigger);
        fireEvent.click(await screen.findByText('Export conversation'));
        fireEvent.click(menuTrigger);
        fireEvent.click(await screen.findByText('Export artifacts'));

        expect(onExportConversation).toHaveBeenCalledWith(conversation);
        expect(onExportArtifacts).toHaveBeenCalledWith(conversation);
    });

    it('should trigger conversation delete from the row actions', async () => {
        const onDeleteConversation = vi.fn();

        render(
            <AntigravityConversationsTable
                conversations={[conversation]}
                decryptionState={unlockedState}
                onDeleteConversation={onDeleteConversation}
                onDeleteConversations={vi.fn()}
                onExportArtifacts={vi.fn()}
                onExportConversation={vi.fn()}
                onExportConversations={vi.fn()}
            />,
        );

        const menuTrigger = screen
            .getAllByRole('button')
            .find((button) => button.getAttribute('aria-haspopup') === 'menu');
        if (!menuTrigger) {
            throw new Error('expected a row action menu trigger');
        }

        fireEvent.click(menuTrigger);
        fireEvent.click(await screen.findByText('Delete conversation'));

        expect(onDeleteConversation).toHaveBeenCalledWith(conversation);
    });

    it('should allow selecting multiple conversations and trigger bulk actions', () => {
        const onDeleteConversations = vi.fn();
        const onExportConversations = vi.fn();

        render(
            <AntigravityConversationsTable
                conversations={[
                    conversation,
                    {
                        ...conversation,
                        conversationId: 'conversation-2',
                        title: 'Second workspace sync',
                    },
                ]}
                decryptionState={unlockedState}
                onDeleteConversation={vi.fn()}
                onDeleteConversations={onDeleteConversations}
                onExportArtifacts={vi.fn()}
                onExportConversation={vi.fn()}
                onExportConversations={onExportConversations}
            />,
        );

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row conversation-1' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row conversation-2' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export selected conversations' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete selected conversations' }));

        expect(onExportConversations).toHaveBeenCalledWith(['conversation-1', 'conversation-2']);
        expect(onDeleteConversations).toHaveBeenCalledWith(['conversation-1', 'conversation-2']);
    });

    it('should keep batch export enabled when selected conversations include summary-only rows', () => {
        const onExportConversations = vi.fn();

        render(
            <AntigravityConversationsTable
                conversations={[
                    conversation,
                    {
                        ...conversation,
                        artifactBytes: 0,
                        artifactCount: 0,
                        conversationBytes: 0,
                        conversationId: 'conversation-summary',
                        conversationPath: null,
                        indexedItemCount: 5,
                        title: 'Summary only review',
                        totalBytes: 0,
                        transcriptBytes: 0,
                        transcriptEntryCount: 0,
                        transcriptPath: null,
                        transcriptSource: null,
                    },
                ]}
                decryptionState={unlockedState}
                onDeleteConversation={vi.fn()}
                onDeleteConversations={vi.fn()}
                onExportArtifacts={vi.fn()}
                onExportConversation={vi.fn()}
                onExportConversations={onExportConversations}
            />,
        );

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row conversation-1' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row conversation-summary' }));

        const exportButton = screen.getByRole('button', { name: 'Export selected conversations' });
        expect((exportButton as HTMLButtonElement).disabled).toBe(false);
        expect(screen.getByText('Summary')).toBeTruthy();

        fireEvent.click(exportButton);

        expect(onExportConversations).toHaveBeenCalledWith(['conversation-1', 'conversation-summary']);
    });
});
