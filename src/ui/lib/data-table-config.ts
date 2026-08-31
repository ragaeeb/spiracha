import {
    type ColumnDef,
    columnFilteringFeature,
    columnVisibilityFeature,
    createColumnHelper,
    createExpandedRowModel,
    createFilteredRowModel,
    createPaginatedRowModel,
    createSortedRowModel,
    type RowData,
    rowExpandingFeature,
    rowPaginationFeature,
    rowSelectionFeature,
    rowSortingFeature,
    tableFeatures,
} from '@tanstack/react-table';

const dataTableFeatures = tableFeatures({
    columnFilteringFeature,
    columnVisibilityFeature,
    expandedRowModel: createExpandedRowModel(),
    filteredRowModel: createFilteredRowModel(),
    paginatedRowModel: createPaginatedRowModel(),
    rowExpandingFeature,
    rowPaginationFeature,
    rowSelectionFeature,
    rowSortingFeature,
    sortedRowModel: createSortedRowModel(),
});

type DataTableColumnDef<TData extends RowData, TValue = unknown> = ColumnDef<typeof dataTableFeatures, TData, TValue>;

const createDataTableColumnHelper = <TData extends RowData>() => createColumnHelper<typeof dataTableFeatures, TData>();

export type { DataTableColumnDef };
export { createDataTableColumnHelper, dataTableFeatures };
