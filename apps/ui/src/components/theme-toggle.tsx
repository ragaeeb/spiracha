import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '#/components/ui/button';

type ThemeMode = 'dark' | 'light';

const getPreferredTheme = (): ThemeMode => {
    if (typeof window === 'undefined') {
        return 'light';
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const applyTheme = (mode: ThemeMode) => {
    document.documentElement.classList.toggle('dark', mode === 'dark');
    document.documentElement.classList.toggle('light', mode === 'light');
    document.documentElement.style.colorScheme = mode;
    window.localStorage.setItem('spiracha-theme', mode);
};

export function ThemeToggle() {
    const [theme, setTheme] = useState<ThemeMode>('light');

    useEffect(() => {
        const storedTheme = window.localStorage.getItem('spiracha-theme');
        const nextTheme = storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : getPreferredTheme();
        setTheme(nextTheme);
        applyTheme(nextTheme);
    }, []);

    return (
        <Button
            aria-label="Toggle color theme"
            className="h-9 rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 text-[var(--panel-foreground)] shadow-none"
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => {
                const nextTheme = theme === 'light' ? 'dark' : 'light';
                setTheme(nextTheme);
                applyTheme(nextTheme);
            }}
        >
            {theme === 'light' ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </Button>
    );
}
