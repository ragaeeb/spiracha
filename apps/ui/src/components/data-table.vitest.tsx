import type { ColumnDef } from '@tanstack/react-table';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './data-table';

type Row = {
    id: string;
    model: string;
    tokens: number;
};

const columns: ColumnDef<Row>[] = [
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

        fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select all rows' })[0]!);
        expect(screen.getByText('3 selected')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(screen.getByText('0 selected')).toBeTruthy();
    });
});
