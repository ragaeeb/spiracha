import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LockKeyhole, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { antigravityDecryptionQueryOptions } from '#/lib/antigravity-queries';
import { unlockAntigravityDecryptionFn } from '#/lib/antigravity-server';
import { cn } from '#/lib/utils';

export function AntigravityKeychainPanel() {
    const queryClient = useQueryClient();
    const decryptionQuery = useQuery(antigravityDecryptionQueryOptions());
    const decryptionState = decryptionQuery.data ?? null;
    const unlockMutation = useMutation({
        mutationFn: () => unlockAntigravityDecryptionFn(),
        onSuccess: (result) => {
            queryClient.setQueryData(antigravityDecryptionQueryOptions().queryKey, result);
            void Promise.all([
                queryClient.invalidateQueries({ queryKey: antigravityDecryptionQueryOptions().queryKey }),
                queryClient.invalidateQueries({ queryKey: ['antigravity-conversation'] }),
            ]);
        },
    });

    if (!decryptionState || decryptionState.status === 'unsupported') {
        return null;
    }

    const isUnlocked = decryptionState.isUnlocked;
    const error = unlockMutation.error?.message ?? decryptionState.error;

    return (
        <div
            className={cn(
                'flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
                isUnlocked ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-[var(--border)] bg-[var(--panel)]',
            )}
        >
            <div className="flex min-w-0 items-start gap-3">
                <div
                    className={cn(
                        'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md',
                        isUnlocked ? 'bg-emerald-500/15 text-emerald-600' : 'bg-[var(--panel-secondary)]',
                    )}
                >
                    {isUnlocked ? <ShieldCheck className="size-4" /> : <LockKeyhole className="size-4" />}
                </div>
                <div className="min-w-0">
                    <p className="font-medium text-sm">
                        {isUnlocked ? 'Keychain access enabled' : 'Unlock Antigravity transcript export'}
                    </p>
                    <p className="mt-1 text-[var(--muted-foreground)] text-xs">
                        {isUnlocked
                            ? 'The Antigravity key is cached in this server process only. Transcript exports are available for local logs and safe-storage payloads.'
                            : `Spiracha needs one-time access to ${decryptionState.keychainService} to decrypt Antigravity transcript data. macOS will ask for approval after you click unlock.`}
                    </p>
                    {error ? (
                        <p className="mt-2 flex items-center gap-1 text-[var(--destructive)] text-xs">
                            <TriangleAlert className="size-3" />
                            {error}
                        </p>
                    ) : null}
                </div>
            </div>
            {!isUnlocked ? (
                <Button
                    className="shrink-0"
                    disabled={!decryptionState.canRequestAccess || unlockMutation.isPending}
                    type="button"
                    onClick={() => unlockMutation.mutate()}
                >
                    <KeyRound className="size-4" />
                    {unlockMutation.isPending ? 'Waiting...' : 'Unlock'}
                </Button>
            ) : null}
        </div>
    );
}
