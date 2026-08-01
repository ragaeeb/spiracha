import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AppShell } from '#/components/app-shell';
import { TooltipProvider } from '#/components/ui/tooltip';
import { getErrorPresentation } from '#/lib/error-presentation';
import { getInitialSettingsFn } from '#/lib/settings-server';
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
    const presentation = getErrorPresentation(error, { fallbackTitle: 'Something went wrong' });

    return (
        <div className="flex min-h-screen items-center justify-center bg-[#101418] px-4 text-[#eef3f7]">
            <div className="max-w-[30rem] text-center">
                <h1 className="mb-3 font-semibold text-base">{presentation.title}</h1>
                {presentation.isDatabaseError ? (
                    <p className="my-2 text-[#99a3af] text-[0.875rem] leading-6">{presentation.description}</p>
                ) : (
                    <p className="my-2 text-[#99a3af] text-[0.875rem] leading-6">
                        <code className="rounded border border-white/10 bg-[#12181e] px-1.5 py-1 text-[0.8em]">
                            {presentation.description}
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
            {
                href: '/icon.svg',
                rel: 'icon',
                type: 'image/svg+xml',
            },
            {
                href: '/manifest.json',
                rel: 'manifest',
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
                    'Browse local Codex, Claude Code, Grok, Kiro, Qoder, Cursor, Antigravity, MiniMax Code, and OpenCode history through a compact workspace UI.',
                name: 'description',
            },
            {
                title: 'Spiracha UI',
            },
        ],
    }),
    loader: () => getInitialSettingsFn(),
});

function RootComponent() {
    const initialSettings = Route.useLoaderData();

    return (
        <RootDocument>
            <SettingsProvider initialSettings={initialSettings}>
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
