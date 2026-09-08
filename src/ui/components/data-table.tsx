import { flexRender, type RowData, type RowSelectionState, type SortingState, useTable } from '@tanstack/react-table';
import { ArrowDownUp } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Checkbox } from '#/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table';
import { type DataTableColumnDef, dataTableFeatures } from '#/lib/data-table-config';
import { cn } from '#/lib/utils';

type DataTableProps<TData extends RowData> = {
    className?: string;
    columns: ReadonlyArray<DataTableColumnDef<TData, any>>;
    data: TData[];
    emptyMessage: string;
    enableRowSelection?: boolean;
    expandAllRows?: boolean;
    getRowId?: (row: TData, index: number) => string;
    getSubRows?: (row: TData, index: number) => TData[] | undefined;
    initialSorting?: SortingState;
    onRowClick?: (row: TData) => void;
    pageSize?: number;
    renderToolbar?: (input: { clearSelection: () => void; selectedRows: TData[] }) => ReactNode;
};

const DEFAULT_PAGE_SIZE = 50;

const getSortIndicator = (value: false | 'asc' | 'desc') => {
    if (value === 'asc') {
        return '↑';
    }

    if (value === 'desc') {
        return '↓';
    }

    return <ArrowDownUp className="size-3" />;
};

const getRangeRowIds = (visibleRowIds: string[], anchorRowId: string, targetRowId: string) => {
    const anchorIndex = visibleRowIds.indexOf(anchorRowId);
    const targetIndex = visibleRowIds.indexOf(targetRowId);

    if (anchorIndex === -1 || targetIndex === -1) {
        return null;
    }

    const [startIndex, endIndex] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
    return visibleRowIds.slice(startIndex, endIndex + 1);
};

const applySelectionState = (selection: RowSelectionState, rowIds: string[], checked: boolean) => {
    const nextSelection = { ...selection };

    for (const rowId of rowIds) {
        if (checked) {
            nextSelection[rowId] = true;
            continue;
        }

        delete nextSelection[rowId];
    }

    return nextSelection;
};

const getDataRowIds = <TData extends RowData>(
    data: TData[],
    getRowId: DataTableProps<TData>['getRowId'],
    getSubRows: DataTableProps<TData>['getSubRows'],
    parentPath = '',
): string[] => {
    return data.flatMap((row, index) => {
        const rowId = getRowId ? getRowId(row, index) : `${parentPath}${index}`;
        const childRows = getSubRows?.(row, index) ?? [];
        return [rowId, ...getDataRowIds(childRows, getRowId, getSubRows, `${rowId}.`)];
    });
};

export function DataTable<TData extends RowData>({
    className,
    columns,
    data,
    emptyMessage,
    enableRowSelection = false,
    expandAllRows = false,
    getRowId,
    getSubRows,
    initialSorting = [],
    onRowClick,
    pageSize = DEFAULT_PAGE_SIZE,
    renderToolbar,
}: DataTableProps<TData>) {
    const [sorting, setSorting] = useState<SortingState>(initialSorting);
    const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
    const lastSelectedRowIdRef = useRef<string | null>(null);
    const pendingShiftSelectionRowIdRef = useRef<string | null>(null);
    const currentRowIds = useMemo(
        () => new Set(getDataRowIds(data, getRowId, getSubRows)),
        [data, getRowId, getSubRows],
    );

    useEffect(() => {
        setRowSelection((selection) => {
            const next = Object.fromEntries(
                Object.entries(selection).filter(([rowId, selected]) => selected && currentRowIds.has(rowId)),
            );
            return Object.keys(next).length === Object.keys(selection).length ? selection : next;
        });
        if (lastSelectedRowIdRef.current && !currentRowIds.has(lastSelectedRowIdRef.current)) {
            lastSelectedRowIdRef.current = null;
        }
    }, [currentRowIds]);

    const updateSelectionForRow = (rowId: string, checked: boolean, shiftKey: boolean) => {
        const visibleRowIds = table.getPaginatedRowModel().rows.map((row) => row.id);

        if (shiftKey && lastSelectedRowIdRef.current) {
            const rangeRowIds = getRangeRowIds(visibleRowIds, lastSelectedRowIdRef.current, rowId);
            if (rangeRowIds) {
                setRowSelection((selection) => applySelectionState(selection, rangeRowIds, checked));
                lastSelectedRowIdRef.current = rowId;
                return;
            }
        }

        setRowSelection((selection) => applySelectionState(selection, [rowId], checked));
        lastSelectedRowIdRef.current = rowId;
    };

    const selectionColumn: DataTableColumnDef<TData, any> = {
        cell: ({ row }) => (
            <Checkbox
                aria-label={`Select row ${row.id}`}
                checked={row.getIsSelected()}
                onPointerDown={(event) => {
                    event.stopPropagation();
                    pendingShiftSelectionRowIdRef.current = event.shiftKey ? row.id : null;
                }}
                onCheckedChange={(checked) => {
                    if (typeof checked !== 'boolean') {
                        return;
                    }

                    const shiftKey = pendingShiftSelectionRowIdRef.current === row.id;
                    pendingShiftSelectionRowIdRef.current = null;
                    updateSelectionForRow(row.id, checked, shiftKey);
                }}
            />
        ),
        enableSorting: false,
        header: ({ table }) => (
            <Checkbox
                aria-label="Select all rows"
                checked={
                    table.getIsAllPageRowsSelected()
                        ? true
                        : table.getIsSomePageRowsSelected()
                          ? 'indeterminate'
                          : false
                }
                onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
            />
        ),
        id: 'select',
    };
    const tableColumns = enableRowSelection ? [selectionColumn, ...columns] : [...columns];
    const table = useTable<typeof dataTableFeatures, TData>({
        autoResetPageIndex: true,
        columns: tableColumns,
        data,
        enableRowSelection,
        enableSortingRemoval: false,
        features: dataTableFeatures,
        getRowId,
        getSubRows,
        initialState: { pagination: { pageIndex: 0, pageSize } },
        onRowSelectionChange: setRowSelection,
        onSortingChange: setSorting,
        sortDescFirst: false,
        state: {
            expanded: expandAllRows ? true : {},
            rowSelection,
            sorting,
        },
    });
    const visibleRows = table.getPaginatedRowModel().rows;
    const selectedRows = table.getSelectedRowModel().flatRows.map((row) => row.original);

    return (
        <div
            className={cn(
                'w-full overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--panel)]',
                className,
            )}
        >
            {renderToolbar ? (
                <div className="border-[var(--border)] border-b px-3 py-2">
                    {renderToolbar({
                        clearSelection: () => setRowSelection({}),
                        selectedRows,
                    })}
                </div>
            ) : null}
            <Table className="min-w-full">
                <TableHeader className="bg-[var(--panel-secondary)]">
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id} className="border-[var(--border)] hover:bg-transparent">
                            {headerGroup.headers.map((header) => (
                                <TableHead
                                    key={header.id}
                                    className="h-9 whitespace-nowrap px-3 font-semibold text-[11px] text-[var(--muted-foreground)] uppercase tracking-[0.18em]"
                                >
                                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                                        <button
                                            className="inline-flex items-center gap-1.5 text-left"
                                            type="button"
                                            onClick={header.column.getToggleSortingHandler()}
                                        >
                                            <span>
                                                {flexRender(header.column.columnDef.header, header.getContext())}
                                            </span>
                                            <span aria-hidden="true" className="text-[10px]">
                                                {getSortIndicator(header.column.getIsSorted())}
                                            </span>
                                        </button>
                                    ) : (
                                        flexRender(header.column.columnDef.header, header.getContext())
                                    )}
                                </TableHead>
                            ))}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody>
                    {visibleRows.length === 0 ? (
                        <TableRow className="border-[var(--border)]">
                            <TableCell
                                className="px-3 py-8 text-center text-[var(--muted-foreground)] text-sm"
                                colSpan={tableColumns.length}
                            >
                                {emptyMessage}
                            </TableCell>
                        </TableRow>
                    ) : (
                        visibleRows.map((row) => {
                            const clickable = Boolean(onRowClick);

                            return (
                                <TableRow
                                    key={row.id}
                                    className={cn(
                                        'border-[var(--border)] hover:bg-[var(--panel-secondary)]/75',
                                        clickable ? 'cursor-pointer' : '',
                                    )}
                                    onClick={() => {
                                        if (!onRowClick) {
                                            return;
                                        }
                                        onRowClick(row.original);
                                    }}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id} className="px-3 py-2 align-top">
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            );
                        })
                    )}
                </TableBody>
            </Table>
            {table.getPageCount() > 1 ? (
                <div className="flex items-center justify-between border-[var(--border)] border-t px-3 py-2">
                    <span className="text-[var(--muted-foreground)] text-sm">
                        Page {(table.atoms.pagination?.get().pageIndex ?? 0) + 1} of {table.getPageCount()}
                    </span>
                    <div className="flex gap-2">
                        <Button
                            aria-label="Previous page"
                            disabled={!table.getCanPreviousPage()}
                            size="sm"
                            type="button"
                            variant="outline"
                            onClick={() => table.previousPage()}
                        >
                            Previous
                        </Button>
                        <Button
                            aria-label="Next page"
                            disabled={!table.getCanNextPage()}
                            size="sm"
                            type="button"
                            variant="outline"
                            onClick={() => table.nextPage()}
                        >
                            Next
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
