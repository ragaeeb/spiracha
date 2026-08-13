import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

type BreadcrumbItem =
    | {
          label: string;
          title?: string;
          truncate?: boolean;
      }
    | {
          label: string;
          params?: Record<string, string>;
          search?: Record<string, unknown>;
          title?: string;
          to: string;
          truncate?: boolean;
      };

type BreadcrumbsProps = {
    items: BreadcrumbItem[];
};

const isLinkItem = (item: BreadcrumbItem): item is Extract<BreadcrumbItem, { to: string }> => {
    return 'to' in item;
};

const classNames = (...values: string[]) => values.filter(Boolean).join(' ');

export const Breadcrumbs = ({ items }: BreadcrumbsProps) => {
    return (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
            {items.map((item, index) => {
                const title = item.title ?? (item.truncate ? item.label : undefined);
                const truncateClassName = item.truncate
                    ? 'inline-block max-w-[min(34rem,62vw)] truncate align-bottom'
                    : '';
                const content: ReactNode = isLinkItem(item) ? (
                    <Link
                        className={classNames(
                            truncateClassName,
                            'text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]',
                        )}
                        params={item.params}
                        search={item.search}
                        title={title}
                        to={item.to}
                    >
                        {item.label}
                    </Link>
                ) : (
                    <span
                        aria-current="page"
                        className={classNames(truncateClassName, 'font-medium text-[var(--foreground)]')}
                        title={title}
                    >
                        {item.label}
                    </span>
                );

                return (
                    <div
                        className="flex min-w-0 items-center gap-1"
                        key={isLinkItem(item) ? `${item.label}-${item.to}-${index}` : `${item.label}-current-${index}`}
                    >
                        {index > 0 ? <ChevronRight className="size-3.5 text-[var(--muted-foreground)]" /> : null}
                        {content}
                    </div>
                );
            })}
        </nav>
    );
};
