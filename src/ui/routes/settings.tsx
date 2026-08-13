import { createFileRoute } from '@tanstack/react-router';
import { Settings2 } from 'lucide-react';
import { PageHeader } from '#/components/page-header';
import { Checkbox } from '#/components/ui/checkbox';
import { useSettings } from '#/lib/settings-store';

export const Route = createFileRoute('/settings')({
    component: SettingsPage,
});

function SettingsPage() {
    const { settings, updateSetting } = useSettings();

    return (
        <div className="space-y-4">
            <PageHeader
                eyebrow="Configuration"
                subtitle="Control how paths and usernames appear in transcript messages."
                title="Settings"
            />

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-[var(--panel-shadow)]">
                <h3 className="flex items-center gap-2 font-semibold text-[var(--muted-foreground)] text-xs uppercase tracking-[0.18em]">
                    <Settings2 className="size-3.5" />
                    Privacy
                </h3>

                <div className="mt-4 space-y-4">
                    <div className="flex items-center gap-3">
                        <Checkbox
                            checked={settings.redactUsername}
                            id="redact-username"
                            onCheckedChange={(checked) => updateSetting('redactUsername', checked === true)}
                        />
                        <div className="min-w-0">
                            <label
                                className="cursor-pointer font-medium text-sm leading-none"
                                htmlFor="redact-username"
                            >
                                Redact Username
                            </label>
                            <p className="mt-1.5 text-[var(--muted-foreground)] text-xs leading-5">
                                Replaces{' '}
                                <code className="rounded bg-[var(--code-background)] px-1 py-0.5 font-mono text-[var(--code-foreground)]">
                                    /Users/[username]/
                                </code>{' '}
                                with{' '}
                                <code className="rounded bg-[var(--code-background)] px-1 py-0.5 font-mono text-[var(--code-foreground)]">
                                    ~/
                                </code>{' '}
                                in all transcript messages.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Checkbox
                            checked={settings.convertToProjectRoot}
                            id="convert-project-root"
                            onCheckedChange={(checked) => updateSetting('convertToProjectRoot', checked === true)}
                        />
                        <div className="min-w-0">
                            <label
                                className="cursor-pointer font-medium text-sm leading-none"
                                htmlFor="convert-project-root"
                            >
                                Convert Absolute Paths to Project Root
                            </label>
                            <p className="mt-1.5 text-[var(--muted-foreground)] text-xs leading-5">
                                Converts the current thread or project cwd from{' '}
                                <code className="rounded bg-[var(--code-background)] px-1 py-0.5 font-mono text-[var(--code-foreground)]">
                                    /Users/[username]/workspace/[projectname]/
                                </code>{' '}
                                to project-root-relative paths, so{' '}
                                <code className="rounded bg-[var(--code-background)] px-1 py-0.5 font-mono text-[var(--code-foreground)]">
                                    /Users/jane/workspace/myapp/src/index.ts
                                </code>{' '}
                                appear as{' '}
                                <code className="rounded bg-[var(--code-background)] px-1 py-0.5 font-mono text-[var(--code-foreground)]">
                                    src/index.ts
                                </code>
                                . If Redact Username is also enabled, remaining absolute paths outside the project root
                                are redacted afterward.
                            </p>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
