import type { ReactNode } from 'react';

type PageHeaderProps = {
    actions?: ReactNode;
    breadcrumb?: ReactNode;
    eyebrow?: string;
    subtitle?: string;
    title: string;
};

export function PageHeader({ actions, breadcrumb, eyebrow, subtitle, title }: PageHeaderProps) {
    return (
        <div className="flex flex-col gap-4 border-[var(--border)] border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
                {breadcrumb ? <div>{breadcrumb}</div> : null}
                {eyebrow ? (
                    <p className="font-semibold text-[11px] text-[var(--muted-foreground)] uppercase tracking-[0.18em]">
                        {eyebrow}
                    </p>
                ) : null}
                <div>
                    <h2 className="font-semibold text-2xl tracking-[-0.03em] sm:text-[2rem]">{title}</h2>
                    {subtitle ? (
                        <p className="mt-2 max-w-[60rem] whitespace-pre-wrap break-words text-[var(--muted-foreground)] text-sm">
                            {subtitle}
                        </p>
                    ) : null}
                </div>
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
    );
}
