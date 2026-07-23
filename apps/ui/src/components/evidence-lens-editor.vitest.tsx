import type { EvidenceLens } from '@spiracha/lib/conversation-data/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
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
});
