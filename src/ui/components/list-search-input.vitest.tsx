import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { startTransitionMock } = vi.hoisted(() => ({
    startTransitionMock: vi.fn((callback: () => void) => callback()),
}));

vi.mock('react', async () => {
    const actual = await vi.importActual<typeof import('react')>('react');
    return {
        ...actual,
        startTransition: startTransitionMock,
    };
});

import { ListSearchInput } from './list-search-input';

describe('ListSearchInput', () => {
    it('should update controlled input state without wrapping onChange in a transition', () => {
        const onValueChange = vi.fn();

        render(<ListSearchInput placeholder="Search threads" value="" onValueChange={onValueChange} />);

        fireEvent.change(screen.getByPlaceholderText('Search threads'), {
            target: { value: 'cursor thread' },
        });

        expect(onValueChange).toHaveBeenCalledWith('cursor thread');
        expect(startTransitionMock).not.toHaveBeenCalled();
    });
});
