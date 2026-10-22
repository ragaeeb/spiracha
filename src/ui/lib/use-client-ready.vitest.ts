import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useClientReady } from './use-client-ready';

const ServerProbe = () => String(useClientReady());

describe('useClientReady', () => {
    it('should remain false during SSR and enable deferred browser queries after hydration', async () => {
        expect(renderToString(createElement(ServerProbe))).toBe('false');

        const { result } = renderHook(() => useClientReady());
        await waitFor(() => expect(result.current).toBe(true));
    });
});
