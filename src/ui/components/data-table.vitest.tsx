import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataTableColumnDef } from '#/lib/data-table-config';
import { DataTable } from './data-table';

type Row = {
    id: string;
    model: string;
    tokens: number;
};

const columns: DataTableColumnDef<Row>[] = [
    {
        accessorKey: 'model',
        cell: (info) => info.getValue<string>(),
        header: 'Model',
        id: 'model',
    },
    {
        accessorKey: 'tokens',
        cell: (info) => info.getValue<number>(),
        header: 'Tokens',
        id: 'tokens',
    },
];

const rows: Row[] = [
    { id: 'row-1', model: 'gpt-5.5', tokens: 30 },
    { id: 'row-2', model: 'gpt-5.4', tokens: 10 },
    { id: 'row-3', model: 'gpt-5.3', tokens: 20 },
];

afterEach(() => {
    cleanup();
});

describe('DataTable', () => {
    it('should toggle header sorting between ascending and descending order', () => {
        render(<DataTable columns={columns} data={rows} emptyMessage="No rows" />);

        const header = screen.getByRole('button', { name: /tokens/i });
        fireEvent.click(header);

        const tokenCellsAfterAsc = screen.getAllByRole('cell').filter((cell) => /^\d+$/.test(cell.textContent ?? ''));
        expect(tokenCellsAfterAsc.map((cell) => cell.textContent)).toEqual(['10', '20', '30']);

        fireEvent.click(header);

        const tokenCellsAfterDesc = screen.getAllByRole('cell').filter((cell) => /^\d+$/.test(cell.textContent ?? ''));
        expect(tokenCellsAfterDesc.map((cell) => cell.textContent)).toEqual(['30', '20', '10']);
    });

    it('should support shift-click checkbox selection across a visible row range', () => {
        render(
            <DataTable
                columns={columns}
                data={rows}
                emptyMessage="No rows"
                enableRowSelection
                getRowId={(row) => row.id}
                renderToolbar={({ selectedRows }) => <span>{selectedRows.map((row) => row.id).join(',')}</span>}
            />,
        );

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row row-1' }));
        const rowThreeCheckbox = screen.getByRole('checkbox', { name: /select row row-3/i });
        fireEvent.pointerDown(rowThreeCheckbox, { shiftKey: true });
        fireEvent.click(rowThreeCheckbox, { shiftKey: true });

        expect(screen.getByText((content) => content.includes('row-1,row-2,row-3'))).toBeTruthy();
    });

    it('should render empty states and invoke row click handlers', () => {
        const onRowClick = vi.fn();

        const { rerender } = render(
            <DataTable columns={columns} data={[]} emptyMessage="No rows" onRowClick={onRowClick} />,
        );

        expect(screen.getByText('No rows')).toBeTruthy();

        rerender(<DataTable columns={columns} data={rows} emptyMessage="No rows" onRowClick={onRowClick} />);

        fireEvent.click(screen.getAllByText('gpt-5.5')[0]!);
        expect(onRowClick).toHaveBeenCalledWith(rows[0]);
    });

    it('should clear selected rows through the custom toolbar action', () => {
        render(
            <DataTable
                columns={columns}
                data={rows}
                emptyMessage="No rows"
                enableRowSelection
                getRowId={(row) => row.id}
                renderToolbar={({ clearSelection, selectedRows }) => (
                    <div>
                        <span>{selectedRows.length} selected</span>
                        <button type="button" onClick={clearSelection}>
                            Clear
                        </button>
                    </div>
                )}
            />,
        );

        fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select all loaded rows' })[0]!);
        expect(screen.getByText('3 selected')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(screen.getByText('0 selected')).toBeTruthy();
    });

    it('should keep selected ids that are only hidden by a filtered page', () => {
        const renderToolbar = ({
            hiddenSelectedCount,
            selectedIds,
        }: {
            hiddenSelectedCount: number;
            selectedIds: string[];
        }) => <span>{`${selectedIds.join(',') || 'none'} hidden:${hiddenSelectedCount}`}</span>;
        const { rerender } = render(
            <DataTable
                authoritativeRowIds={rows.map((row) => row.id)}
                columns={columns}
                data={rows}
                emptyMessage="No rows"
                enableRowSelection
                getRowId={(row) => row.id}
                inventoryIdentity="source:workspace-a"
                renderToolbar={renderToolbar}
            />,
        );
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row row-1' }));
        expect(screen.getByText('row-1 hidden:0')).toBeTruthy();

        rerender(
            <DataTable
                authoritativeRowIds={rows.map((row) => row.id)}
                columns={columns}
                data={rows.slice(1)}
                emptyMessage="No rows"
                enableRowSelection
                getRowId={(row) => row.id}
                inventoryIdentity="source:workspace-a"
                renderToolbar={renderToolbar}
            />,
        );

        expect(screen.getByText('row-1 hidden:1')).toBeTruthy();
    });

    it('should compute toolbar selectedRows from authoritative inventory when a selected row is filtered away', () => {
        const renderToolbar = ({ selectedIds, selectedRows }: { selectedIds: string[]; selectedRows: Row[] }) => (
            <span>{`${selectedIds.join(',')}:${selectedRows.map((row) => row.model).join(',') || 'none'}`}</span>
        );
        const { rerender } = render(
            <DataTable
                authoritativeRowIds={rows.map((row) => row.id)}
                authoritativeRows={rows}
                columns={columns}
                data={rows}
                emptyMessage="No rows"
                enableRowSelection
                getRowId={(row) => row.id}
                renderToolbar={renderToolbar}
            />,
        );
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row row-1' }));
        expect(screen.getByText('row-1:gpt-5.5')).toBeTruthy();

        rerender(
            <DataTable
                authoritativeRowIds={rows.map((row) => row.id)}
                authoritativeRows={rows}
                columns={columns}
                data={rows.slice(1)}
                emptyMessage="No rows"
                enableRowSelection
                getRowId={(row) => row.id}
                renderToolbar={renderToolbar}
            />,
        );

        expect(screen.getByText('row-1:gpt-5.5')).toBeTruthy();
    });

    it('should drop selected ids that leave the authoritative membership', () => {
        const renderToolbar = ({ selectedIds }: { selectedIds: string[] }) => (
            <span>{selectedIds.join(',') || 'none'}</span>
        );
        const { rerender } = render(
            <DataTable
                authoritativeRowIds={['row-1', 'row-2', 'row-3']}
                columns={columns}
                data={rows}
                emptyMessage="No rows"
                enableRowSelection
                getRowId={(row) => row.id}
                renderToolbar={renderToolbar}
            />,
        );
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row row-1' }));
        expect(screen.getByText('row-1')).toBeTruthy();

        rerender(
            <DataTable
                authoritativeRowIds={['row-2', 'row-3']}
                columns={columns}
                data={rows.slice(1)}
                emptyMessage="No rows"
                enableRowSelection
                getRowId={(row) => row.id}
                renderToolbar={renderToolbar}
            />,
        );

        expect(screen.getByText('none')).toBeTruthy();
    });

    it('should reset selection when the inventory identity changes', () => {
        const renderToolbar = ({ selectedIds }: { selectedIds: string[] }) => (
            <span>{selectedIds.join(',') || 'none'}</span>
        );
        const { rerender } = render(
            <DataTable
                authoritativeRowIds={['row-1', 'row-2', 'row-3']}
                columns={columns}
                data={rows}
                emptyMessage="No rows"
                enableRowSelection
                getRowId={(row) => row.id}
                inventoryIdentity="source:workspace-a"
                renderToolbar={renderToolbar}
            />,
        );
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row row-1' }));
        expect(screen.getByText('row-1')).toBeTruthy();

        rerender(
            <DataTable
                authoritativeRowIds={['row-1', 'row-2', 'row-3']}
                columns={columns}
                data={rows}
                emptyMessage="No rows"
                enableRowSelection
                getRowId={(row) => row.id}
                inventoryIdentity="source:workspace-b"
                renderToolbar={renderToolbar}
            />,
        );

        expect(screen.getByText('none')).toBeTruthy();
    });

    it('should select only the rows loaded so far and include newly loaded rows after loading more', () => {
        const renderToolbar = ({ selectedIds }: { selectedIds: string[] }) => (
            <span>{[...selectedIds].sort().join(',') || 'none'}</span>
        );
        render(
            <DataTable
                columns={columns}
                data={rows}
                emptyMessage="No rows"
                enableRowSelection
                getRowId={(row) => row.id}
                pageSize={2}
                renderToolbar={renderToolbar}
            />,
        );

        fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select all loaded rows' })[0]!);
        expect(screen.getByText('row-1,row-2')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row row-3' }));
        expect(screen.getByText('row-1,row-2,row-3')).toBeTruthy();

        fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select all loaded rows' })[0]!);
        expect(screen.getByText('none')).toBeTruthy();
    });

    it('should include the row title in the checkbox accessible name when provided', () => {
        render(
            <DataTable
                columns={columns}
                data={rows}
                emptyMessage="No rows"
                enableRowSelection
                getRowId={(row) => row.id}
                getRowLabel={(row) => row.model}
            />,
        );

        expect(screen.getByRole('checkbox', { name: 'Select gpt-5.5 row-1' })).toBeTruthy();
    });

    it('should keep selected row ids after sorting and loading more rows', () => {
        render(
            <DataTable
                columns={columns}
                data={rows}
                emptyMessage="No rows"
                enableRowSelection
                getRowId={(row) => row.id}
                pageSize={2}
                renderToolbar={({ selectedRows }) => (
                    <span>{[...selectedRows.map((row) => row.id)].sort().join(',') || 'none'}</span>
                )}
            />,
        );

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row row-1' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row row-2' }));
        expect(screen.getByText('row-1,row-2')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /tokens/i }));
        expect(screen.getByText('row-1,row-2')).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: 'Select row row-2' }).getAttribute('aria-checked')).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        expect(screen.getByText('row-1,row-2')).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: 'Select row row-1' }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('checkbox', { name: 'Select row row-2' }).getAttribute('aria-checked')).toBe('true');
    });

    it('should load more rows in increments instead of paging', () => {
        const manyRows = Array.from({ length: 51 }, (_, index) => ({
            id: `row-${index + 1}`,
            model: `model-${index + 1}`,
            tokens: index + 1,
        }));

        render(<DataTable columns={columns} data={manyRows} emptyMessage="No rows" />);

        expect(screen.getByText('Showing 50 of 51')).toBeTruthy();
        expect(screen.queryByText('model-51')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Previous page' })).toBeNull();
        const loadMore = screen.getByRole('button', { name: 'Load more' });
        expect(loadMore.getAttribute('type')).toBe('button');
        fireEvent.click(loadMore);
        expect(screen.getByText('model-51')).toBeTruthy();
        expect(screen.getByText('model-1')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });

    it('should not offer to load more when every row is already shown', () => {
        render(<DataTable columns={columns} data={rows} emptyMessage="No rows" />);

        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
        expect(screen.queryByText(/^Showing /)).toBeNull();
    });
});
