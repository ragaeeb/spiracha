import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
    beforeEach(() => {
        document.documentElement.className = '';
        document.documentElement.style.colorScheme = '';
        window.localStorage.clear();
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: vi.fn().mockReturnValue({ matches: false }),
        });
    });

    it('should apply the stored theme on mount and toggle it when clicked', () => {
        window.localStorage.setItem('spiracha-theme', 'dark');

        render(<ThemeToggle />);

        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(document.documentElement.style.colorScheme).toBe('dark');

        fireEvent.click(screen.getByRole('button', { name: 'Toggle color theme' }));

        expect(document.documentElement.classList.contains('light')).toBe(true);
        expect(window.localStorage.getItem('spiracha-theme')).toBe('light');
    });

    it('should fall back to the system preference when no theme is stored', () => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: vi.fn().mockReturnValue({ matches: true }),
        });

        render(<ThemeToggle />);

        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(window.localStorage.getItem('spiracha-theme')).toBe('dark');
    });
});
