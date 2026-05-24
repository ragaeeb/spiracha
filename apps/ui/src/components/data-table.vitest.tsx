import type { ColumnDef } from '@tanstack/react-table';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
        fireEvent.click(screen.getByRole('checkbox', { name: /select row row-3/i }), { shiftKey: true });

        expect(screen.getByText((content) => content.includes('row-1,row-2,row-3'))).toBeTruthy();
    });
});
