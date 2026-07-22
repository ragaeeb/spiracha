import type {
    CodexAnalytics,
    DistributionItem,
    ModelTokenSummary,
    ToolUsageSummary,
} from '@spiracha/lib/codex-browser-types';
import { createColumnHelper } from '@tanstack/react-table';
import { formatNumber, formatTokens } from '#/lib/formatters';
import { DataTable } from './data-table';

const toolUsageColumnHelper = createColumnHelper<ToolUsageSummary>();
const toolUsageColumns = [
    toolUsageColumnHelper.accessor('name', {
        cell: (info) => <span className="font-mono text-sm">{info.getValue()}</span>,
        header: 'Tool',
    }),
    toolUsageColumnHelper.accessor('count', {
        cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
        header: 'Calls',
    }),
] as const;

const modelColumnHelper = createColumnHelper<ModelTokenSummary>();
const modelColumns = [
    modelColumnHelper.accessor('model', {
        cell: (info) => <span className="font-mono text-sm">{info.getValue()}</span>,
        header: 'Model',
    }),
    modelColumnHelper.accessor('threadCount', {
        cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
        header: 'Threads',
    }),
    modelColumnHelper.accessor('totalTokens', {
        cell: (info) => <span className="font-mono text-sm">{formatTokens(info.getValue())}</span>,
        header: 'Tokens',
    }),
] as const;

const distributionColumnHelper = createColumnHelper<DistributionItem>();
const distributionColumns = [
    distributionColumnHelper.accessor('label', {
        cell: (info) => <span className="font-mono text-sm">{info.getValue()}</span>,
        header: 'Value',
    }),
    distributionColumnHelper.accessor('count', {
        cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
        header: 'Threads',
    }),
] as const;

type AnalyticsBreakdownsProps = Pick<CodexAnalytics, 'modelsByTokens' | 'reasoningEfforts' | 'sources' | 'toolUsage'>;

export const AnalyticsBreakdowns = ({
    modelsByTokens,
    reasoningEfforts,
    sources,
    toolUsage,
}: AnalyticsBreakdownsProps) => {
    return (
        <div className="grid gap-4 xl:grid-cols-2">
            <section className="space-y-3">
                <div>
                    <h3 className="font-semibold text-sm">Most frequent tool calls</h3>
                    <p className="mt-1 text-[var(--muted-foreground)] text-sm">
                        Useful for future prompt and tool optimization work.
                    </p>
                </div>
                <DataTable columns={toolUsageColumns} data={toolUsage} emptyMessage="No tool calls recorded." />
            </section>

            <section className="space-y-3">
                <div>
                    <h3 className="font-semibold text-sm">Model token breakdown</h3>
                    <p className="mt-1 text-[var(--muted-foreground)] text-sm">
                        Compare model usage and token concentration within the current project scope.
                    </p>
                </div>
                <DataTable columns={modelColumns} data={modelsByTokens} emptyMessage="No model usage recorded." />
            </section>

            <section className="space-y-3">
                <div>
                    <h3 className="font-semibold text-sm">Client source breakdown</h3>
                    <p className="mt-1 text-[var(--muted-foreground)] text-sm">
                        See which Codex clients created threads in the current scope.
                    </p>
                </div>
                <DataTable columns={distributionColumns} data={sources} emptyMessage="No client sources recorded." />
            </section>

            <section className="space-y-3">
                <div>
                    <h3 className="font-semibold text-sm">Reasoning effort breakdown</h3>
                    <p className="mt-1 text-[var(--muted-foreground)] text-sm">
                        Compare configured reasoning effort across threads.
                    </p>
                </div>
                <DataTable
                    columns={distributionColumns}
                    data={reasoningEfforts}
                    emptyMessage="No reasoning effort recorded."
                />
            </section>
        </div>
    );
};
