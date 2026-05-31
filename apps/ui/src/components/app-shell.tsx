import { Link, useRouterState } from '@tanstack/react-router';
import { BarChart3, FolderOpen, LayoutDashboard, Settings2, Sparkles, SquareTerminal } from 'lucide-react';
import type { PropsWithChildren } from 'react';
import { cn } from '#/lib/utils';
import { ThemeToggle } from './theme-toggle';

const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', to: '/' },
    { icon: FolderOpen, label: 'Codex', to: '/projects' },
    { icon: Sparkles, label: 'Antigravity', to: '/antigravity' },
    { icon: SquareTerminal, label: 'Cursor', to: '/cursor' },
    { icon: BarChart3, label: 'Analytics', to: '/analytics' },
    { icon: Settings2, label: 'Settings', to: '/settings' },
] as const;

export function AppShell({ children }: PropsWithChildren) {
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    });

    return (
        <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
            <div className="flex min-h-screen w-full flex-col lg:flex-row">
                <aside className="border-[var(--border)] border-b bg-[var(--panel)]/90 px-5 py-5 backdrop-blur lg:sticky lg:top-0 lg:h-screen lg:w-[240px] lg:border-r lg:border-b-0 lg:px-5">
                    <div className="flex items-start justify-between gap-4 lg:flex-col lg:items-stretch">
                        <div className="space-y-1.5">
                            <p className="font-semibold text-[10px] text-[var(--muted-foreground)] uppercase tracking-[0.18em]">
                                Spiracha
                            </p>
                            <div>
                                <h1 className="font-['IBM_Plex_Sans'] font-semibold text-lg tracking-[-0.02em]">
                                    Spiracha Console
                                </h1>
                            </div>
                        </div>
                        <ThemeToggle />
                    </div>

                    <nav className="mt-5 grid gap-1">
                        {navItems.map((item) => {
                            const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
                            const Icon = item.icon;

                            return (
                                <Link
                                    key={item.to}
                                    className={cn(
                                        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                                        active
                                            ? 'bg-[var(--accent-muted)] font-medium text-[var(--accent-foreground)]'
                                            : 'text-[var(--muted-foreground)] hover:bg-[var(--panel-secondary)] hover:text-[var(--foreground)]',
                                    )}
                                    to={item.to}
                                >
                                    <Icon className="size-4 shrink-0" />
                                    <span>{item.label}</span>
                                </Link>
                            );
                        })}
                    </nav>
                </aside>

                <main className="min-w-0 flex-1 px-4 py-4 sm:px-5 sm:py-5 lg:px-6">{children}</main>
            </div>
        </div>
    );
}
