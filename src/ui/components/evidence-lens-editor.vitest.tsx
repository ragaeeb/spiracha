import { DEFAULT_EVIDENCE_LENS } from '@spiracha/lib/conversation-data/evidence-lens';
import type { EvidenceLens } from '@spiracha/lib/conversation-data/types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvidenceLensEditor } from './evidence-lens-editor';

const initialLens: EvidenceLens = {
    anchors: [{ kind: 'tool', names: ['exec'] }],
    budget: {
        commentaryCharactersPerEpisode: 500,
        failedOutputCharacters: 1_000,
        successfulOutputCharacters: 300,
        totalCharacters: 8_000,
    },
    context: {
        commentaryAfter: 2,
        commentaryBefore: 2,
        followRetries: true,
        followWorkarounds: true,
        includeReasoningSummaries: true,
        maxOrderGap: 8,
    },
    name: 'Initial lens',
};

const Harness = () => {
    const [lens, setLens] = useState(initialLens);
    return <EvidenceLensEditor lens={lens} onChange={setLens} />;
};

describe('EvidenceLensEditor', () => {
    afterEach(cleanup);

    it('should validate imported JSON and export the current lens as versionable JSON', () => {
        render(<Harness />);
        const json = screen.getByLabelText('Lens JSON');

        fireEvent.change(json, { target: { value: '{"name":"broken"}' } });
        fireEvent.click(screen.getByRole('button', { name: 'Import lens JSON' }));
        expect(screen.getByText('anchors: Expected 1-32 anchors.')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Lens name'), { target: { value: 'Versioned lens' } });
        fireEvent.click(screen.getByRole('button', { name: 'Export lens JSON' }));
        expect((json as HTMLTextAreaElement).value).toContain('"name": "Versioned lens"');
        expect(screen.queryByText('anchors: Expected 1-32 anchors.')).toBeNull();
    });

    it('should apply smaller settings only on request and preserve imported anchors and editable budgets', () => {
        render(<Harness />);
        const imported: EvidenceLens = {
            ...initialLens,
            anchors: [{ kind: 'text', literals: ['SIGTERM repair'] }],
            name: 'Cancellation repair',
        };
        fireEvent.change(screen.getByLabelText('Lens JSON'), { target: { value: JSON.stringify(imported) } });
        fireEvent.click(screen.getByRole('button', { name: 'Import lens JSON' }));
        expect((screen.getByLabelText('totalCharacters') as HTMLInputElement).value).toBe('8000');

        fireEvent.click(screen.getByRole('button', { name: 'Use 12k preset' }));
        const smaller = JSON.parse((screen.getByLabelText('Lens JSON') as HTMLTextAreaElement).value);
        expect(smaller).toEqual({
            ...imported,
            budget: {
                commentaryCharactersPerEpisode: 500,
                failedOutputCharacters: 6000,
                successfulOutputCharacters: 500,
                totalCharacters: 12000,
            },
            context: {
                ...imported.context,
                commentaryAfter: 1,
                commentaryBefore: 1,
                followRetries: true,
                followWorkarounds: false,
                includeReasoningSummaries: false,
            },
        });
        expect(screen.getByText(/OR anchors broaden the export/u)).toBeTruthy();
        expect(screen.getByText(/Check matched versus rendered counts/u)).toBeTruthy();
        fireEvent.change(screen.getByLabelText('totalCharacters'), { target: { value: '16000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Export lens JSON' }));
        expect(
            JSON.parse((screen.getByLabelText('Lens JSON') as HTMLTextAreaElement).value).budget.totalCharacters,
        ).toBe(16000);
    });

    it('should ignore invalid numeric context and budget edits', () => {
        const onChange = vi.fn();
        render(<EvidenceLensEditor lens={initialLens} onChange={onChange} />);

        fireEvent.change(screen.getByLabelText('maxOrderGap'), { target: { value: '0' } });
        fireEvent.change(screen.getByLabelText('commentaryBefore'), { target: { value: '-1' } });
        fireEvent.change(screen.getByLabelText('totalCharacters'), { target: { value: '' } });
        fireEvent.change(screen.getByLabelText('successfulOutputCharacters'), { target: { value: 'not-a-number' } });

        expect(onChange).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('maxOrderGap'), { target: { value: '9' } });
        expect(onChange).toHaveBeenCalledWith({ ...initialLens, context: { ...initialLens.context, maxOrderGap: 9 } });
    });

    it('should reset the lens JSON and validation error with the lens value', () => {
        const onChange = vi.fn();
        render(<EvidenceLensEditor lens={initialLens} onChange={onChange} />);
        const json = screen.getByLabelText('Lens JSON');

        fireEvent.change(json, { target: { value: '{"name":"broken"}' } });
        fireEvent.click(screen.getByRole('button', { name: 'Import lens JSON' }));
        expect(screen.getByText('anchors: Expected 1-32 anchors.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

        expect(onChange).toHaveBeenCalledWith(DEFAULT_EVIDENCE_LENS);
        expect((json as HTMLTextAreaElement).value).toBe(JSON.stringify(DEFAULT_EVIDENCE_LENS, null, 2));
        expect(screen.queryByText('anchors: Expected 1-32 anchors.')).toBeNull();
    });
});
