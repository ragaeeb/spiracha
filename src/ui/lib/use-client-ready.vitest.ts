import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useClientReady } from './use-client-ready';

describe('useClientReady', () => {
    it('should remain false during SSR and enable deferred browser queries after hydration', async () => {
        let serverReady: boolean | undefined;
        const ServerProbe = () => {
            serverReady = useClientReady();
            return null;
        };

        renderToString(createElement(ServerProbe));
        expect(serverReady).toBe(false);

        const { result } = renderHook(() => useClientReady());
        await waitFor(() => expect(result.current).toBe(true));
    });
});
