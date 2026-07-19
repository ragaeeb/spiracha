import type { AntigravityDecryptionState } from '@spiracha/lib/antigravity-keychain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const serverFns = vi.hoisted(() => ({
    getAntigravityDecryptionStateFn: vi.fn<() => Promise<AntigravityDecryptionState>>(),
    unlockAntigravityDecryptionFn: vi.fn<() => Promise<AntigravityDecryptionState>>(),
}));

vi.mock('#/lib/antigravity-server', () => ({
    getAntigravityDecryptionStateFn: serverFns.getAntigravityDecryptionStateFn,
    unlockAntigravityDecryptionFn: serverFns.unlockAntigravityDecryptionFn,
}));

import { AntigravityKeychainPanel } from './antigravity-keychain-panel';

const lockedState: AntigravityDecryptionState = {
    canRequestAccess: true,
    error: 'Previous approval was denied',
    isUnlocked: false,
    keychainAccount: 'Antigravity Key',
    keychainService: 'Antigravity Safe Storage',
    platform: 'darwin',
    provider: 'keychain',
    status: 'locked',
};

const unlockedState: AntigravityDecryptionState = {
    ...lockedState,
    error: null,
    isUnlocked: true,
    status: 'unlocked',
};

const unsupportedState: AntigravityDecryptionState = {
    canRequestAccess: false,
    error: null,
    isUnlocked: false,
    keychainAccount: 'Antigravity Key',
    keychainService: 'Antigravity Safe Storage',
    platform: 'linux',
    provider: 'unsupported',
    status: 'unsupported',
};

const renderPanel = (state?: AntigravityDecryptionState) => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    if (state) {
        queryClient.setQueryData(['antigravity-decryption'], state);
    }
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return { ...render(<AntigravityKeychainPanel />, { wrapper: Wrapper }), queryClient };
};

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('AntigravityKeychainPanel', () => {
    it('should remain hidden when keychain decryption is unavailable', () => {
        serverFns.getAntigravityDecryptionStateFn.mockResolvedValue(unsupportedState);
        const { container } = renderPanel(unsupportedState);

        expect(container.innerHTML).toBe('');
    });

    it('should unlock transcript exports and refresh dependent conversation data', async () => {
        serverFns.unlockAntigravityDecryptionFn.mockResolvedValue(unlockedState);
        serverFns.getAntigravityDecryptionStateFn.mockResolvedValue(unlockedState);
        const { queryClient } = renderPanel(lockedState);
        const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

        expect(screen.getByText('Unlock Antigravity transcript export')).toBeTruthy();
        expect(screen.getByText('Previous approval was denied')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

        await waitFor(() => expect(serverFns.unlockAntigravityDecryptionFn).toHaveBeenCalledOnce());
        await waitFor(() => expect(screen.getByText('Keychain access enabled')).toBeTruthy());
        expect(queryClient.getQueryData(['antigravity-decryption'])).toEqual(unlockedState);
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['antigravity-decryption'] });
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['antigravity-conversation'] });
        expect(screen.queryByRole('button', { name: 'Unlock' })).toBeNull();
    });
});
