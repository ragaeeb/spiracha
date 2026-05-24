import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AppShell } from '#/components/app-shell';
import { TooltipProvider } from '#/components/ui/tooltip';
import { SettingsProvider } from '#/lib/settings-store';
import appCss from '#/styles.css?url';

type RouterContext = {
    queryClient: QueryClient;
};

const themeInitScript = `
  (() => {
    try {
      const stored = window.localStorage.getItem('spiracha-theme')
      const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      const mode = stored === 'dark' || stored === 'light' ? stored : preferred
      document.documentElement.classList.add(mode)
      document.documentElement.style.colorScheme = mode
    } catch {}
  })()
`;

function RootErrorComponent({ error }: { error: Error }) {
    const isSqliteError =
        error.message.includes('unable to open database') ||
        error.message.includes('database is locked') ||
        error.message.includes('SQLITE_');

    return (
        <div className="flex min-h-screen items-center justify-center bg-[#101418] px-4 text-[#eef3f7]">
            <div className="max-w-[30rem] text-center">
                <h1 className="mb-3 font-semibold text-base">
                    {isSqliteError ? 'Database unavailable' : 'Something went wrong'}
                </h1>
                {isSqliteError ? (
                    <p className="my-2 text-[#99a3af] text-[0.875rem] leading-6">
                        Spiracha could not open the Codex SQLite database. Codex may have an exclusive lock on the file,
                        or the database does not exist yet. Close Codex or wait a moment, then reload.
                    </p>
                ) : (
                    <p className="my-2 text-[#99a3af] text-[0.875rem] leading-6">
                        <code className="rounded border border-white/10 bg-[#12181e] px-1.5 py-1 text-[0.8em]">
                            {error.message}
                        </code>
                    </p>
                )}
                <button
                    className="mt-6 rounded-full border border-white/15 bg-[#1a222b] px-5 py-2 text-sm hover:bg-[#222e3a]"
                    type="button"
                    onClick={() => window.location.reload()}
                >
                    Reload
                </button>
            </div>
        </div>
    );
}

export const Route = createRootRouteWithContext<RouterContext>()({
    component: RootComponent,
    errorComponent: RootErrorComponent,
    head: () => ({
        links: [
            {
                href: appCss,
                rel: 'stylesheet',
            },
        ],
        meta: [
            {
                charSet: 'utf-8',
            },
            {
                content: 'width=device-width, initial-scale=1',
                name: 'viewport',
            },
            {
                content:
                    'Browse local Codex threads, projects, tool calls, and analytics through a compact workspace UI.',
                name: 'description',
            },
            {
                title: 'Spiracha UI',
            },
        ],
    }),
});

function RootComponent() {
    return (
        <RootDocument>
            <SettingsProvider>
                <TooltipProvider>
                    <AppShell>
                        <Outlet />
                    </AppShell>
                </TooltipProvider>
            </SettingsProvider>
        </RootDocument>
    );
}

function RootDocument({ children }: { children: ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <script>{themeInitScript}</script>
                <HeadContent />
            </head>
            <body>
                {children}
                <Scripts />
            </body>
        </html>
    );
}
