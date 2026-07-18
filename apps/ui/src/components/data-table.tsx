import {
    type ColumnDef,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
    type RowSelectionState,
    type SortingState,
    useReactTable,
} from '@tanstack/react-table';
import { ArrowDownUp } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox } from '#/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table';
import { cn } from '#/lib/utils';

type DataTableProps<TData> = {
    className?: string;
    columns: ReadonlyArray<ColumnDef<TData, any>>;
    data: TData[];
    emptyMessage: string;
    enableRowSelection?: boolean;
    getRowId?: (row: TData, index: number) => string;
    initialSorting?: SortingState;
    onRowClick?: (row: TData) => void;
    renderToolbar?: (input: { clearSelection: () => void; selectedRows: TData[] }) => ReactNode;
};

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

export function DataTable<TData>({
    className,
    columns,
    data,
    emptyMessage,
    enableRowSelection = false,
    getRowId,
    initialSorting = [],
    onRowClick,
    renderToolbar,
}: DataTableProps<TData>) {
    const [sorting, setSorting] = useState<SortingState>(initialSorting);
    const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
    const lastSelectedRowIdRef = useRef<string | null>(null);
    const pendingShiftSelectionRowIdRef = useRef<string | null>(null);
    const currentRowIds = useMemo(
        () => new Set(data.map((row, index) => (getRowId ? getRowId(row, index) : String(index)))),
        [data, getRowId],
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
        const visibleRowIds = table.getRowModel().rows.map((row) => row.id);

        if (shiftKey && lastSelectedRowIdRef.current) {
            const rangeRowIds = getRangeRowIds(visibleRowIds, lastSelectedRowIdRef.current, rowId);
            if (rangeRowIds) {
                setRowSelection(applySelectionState(rowSelection, rangeRowIds, checked));
                lastSelectedRowIdRef.current = rowId;
                return;
            }
        }

        setRowSelection(applySelectionState(rowSelection, [rowId], checked));
        lastSelectedRowIdRef.current = rowId;
    };

    const selectionColumn: ColumnDef<TData, any> = {
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
    const table = useReactTable({
        autoResetPageIndex: false,
        columns: tableColumns,
        data,
        enableRowSelection,
        enableSortingRemoval: false,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getRowId,
        getSortedRowModel: getSortedRowModel(),
        onRowSelectionChange: setRowSelection,
        onSortingChange: setSorting,
        sortDescFirst: false,
        state: {
            rowSelection,
            sorting,
        },
    });
    const selectedRows = table.getSelectedRowModel().rows.map((row) => row.original);

    return (
        <div
            className={cn(
                'w-full overflow-x-auto rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel)]',
                className,
            )}
        >
            {renderToolbar ? (
                <div className="border-[var(--border)] border-b px-4 py-3">
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
                                    className="h-10 whitespace-nowrap px-4 font-semibold text-[11px] text-[var(--muted-foreground)] uppercase tracking-[0.18em]"
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
                    {table.getRowModel().rows.length === 0 ? (
                        <TableRow className="border-[var(--border)]">
                            <TableCell
                                className="px-4 py-10 text-center text-[var(--muted-foreground)] text-sm"
                                colSpan={tableColumns.length}
                            >
                                {emptyMessage}
                            </TableCell>
                        </TableRow>
                    ) : (
                        table.getRowModel().rows.map((row) => {
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
                                        <TableCell key={cell.id} className="px-4 py-2.5 align-top">
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            );
                        })
                    )}
                </TableBody>
            </Table>
        </div>
    );
}
