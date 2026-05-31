import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

type BreadcrumbItem =
    | {
          label: string;
      }
    | {
          label: string;
          params?: Record<string, string>;
          to: string;
      };

type BreadcrumbsProps = {
    items: BreadcrumbItem[];
};

const isLinkItem = (item: BreadcrumbItem): item is Extract<BreadcrumbItem, { to: string }> => {
    return 'to' in item;
};

export function Breadcrumbs({ items }: BreadcrumbsProps) {
    return (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
            {items.map((item, index) => {
                const content: ReactNode = isLinkItem(item) ? (
                    <Link
                        className="text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
                        params={item.params}
                        to={item.to}
                    >
                        {item.label}
                    </Link>
                ) : (
                    <span className="font-medium text-[var(--foreground)]">{item.label}</span>
                );

                return (
                    <div
                        className="flex items-center gap-1"
                        key={isLinkItem(item) ? `${item.label}-${item.to}-${index}` : `${item.label}-current-${index}`}
                    >
                        {index > 0 ? <ChevronRight className="size-3.5 text-[var(--muted-foreground)]" /> : null}
                        {content}
                    </div>
                );
            })}
        </nav>
    );
}
