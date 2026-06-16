import { Link, useRouterState } from '@tanstack/react-router';
import {
    BarChart3,
    Bot,
    BrainCircuit,
    Code2,
    FolderOpen,
    LayoutDashboard,
    Settings2,
    Sparkles,
    SquareTerminal,
    Workflow,
} from 'lucide-react';
import type { PropsWithChildren } from 'react';
import { packageMetadata } from '#/lib/package-metadata';
import { cn } from '#/lib/utils';
import { ThemeToggle } from './theme-toggle';

type NavItem = {
    activePrefixes?: readonly string[];
    icon: typeof LayoutDashboard;
    label: string;
    to: string;
};

const navItems: readonly NavItem[] = [
    { icon: LayoutDashboard, label: 'Dashboard', to: '/' },
    { activePrefixes: ['/projects', '/threads'], icon: FolderOpen, label: 'Codex', to: '/projects' },
    {
        activePrefixes: ['/claude-code', '/claude-code-sessions'],
        icon: Bot,
        label: 'Claude Code',
        to: '/claude-code',
    },
    { activePrefixes: ['/kiro', '/kiro-sessions'], icon: BrainCircuit, label: 'Kiro', to: '/kiro' },
    { activePrefixes: ['/qoder', '/qoder-sessions'], icon: Workflow, label: 'Qoder', to: '/qoder' },
    {
        activePrefixes: ['/antigravity', '/antigravity-conversations'],
        icon: Sparkles,
        label: 'Antigravity',
        to: '/antigravity',
    },
    { activePrefixes: ['/cursor', '/cursor-threads'], icon: SquareTerminal, label: 'Cursor', to: '/cursor' },
    { activePrefixes: ['/opencode', '/opencode-sessions'], icon: Code2, label: 'OpenCode', to: '/opencode' },
    { icon: BarChart3, label: 'Analytics', to: '/analytics' },
    { icon: Settings2, label: 'Settings', to: '/settings' },
] as const;

const isNavItemActive = (pathname: string, item: NavItem) => {
    const prefixes = item.activePrefixes ?? [item.to];
    return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
};

const GitHubIcon = ({ className }: { className?: string }) => (
    <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.59 2 12.25c0 4.53 2.87 8.36 6.84 9.72.5.09.68-.22.68-.49v-1.9c-2.78.62-3.37-1.22-3.37-1.22-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.56 2.35 1.11 2.92.85.09-.67.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.35 9.35 0 0 1 12 6.98c.85 0 1.7.12 2.5.35 1.9-1.33 2.74-1.05 2.74-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.95.68 1.91v2.78c0 .27.18.59.69.49A10.22 10.22 0 0 0 22 12.25C22 6.59 17.52 2 12 2Z" />
    </svg>
);

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
                                Spiracha <span className="tracking-normal">v{packageMetadata.version}</span>
                            </p>
                            <div className="space-y-1">
                                <h1 className="font-['IBM_Plex_Sans'] font-semibold text-lg tracking-[-0.02em]">
                                    Spiracha Console
                                </h1>
                                {packageMetadata.homepage ? (
                                    <a
                                        aria-label="Open Spiracha GitHub repository"
                                        className="inline-flex size-7 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--panel-secondary)] hover:text-[var(--foreground)]"
                                        href={packageMetadata.homepage}
                                        rel="noreferrer"
                                        target="_blank"
                                    >
                                        <GitHubIcon className="size-4" />
                                    </a>
                                ) : null}
                            </div>
                        </div>
                        <ThemeToggle />
                    </div>

                    <nav className="mt-5 grid gap-1">
                        {navItems.map((item) => {
                            const active = isNavItemActive(pathname, item);
                            const Icon = item.icon;

                            return (
                                <Link
                                    activeOptions={{ includeSearch: false }}
                                    aria-current={active ? 'page' : undefined}
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
