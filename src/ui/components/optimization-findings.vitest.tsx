import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OptimizationFindings } from './optimization-findings';

describe('OptimizationFindings', () => {
    it('should explain ranked waste signals and persona candidates', () => {
        render(
            <OptimizationFindings
                optimization={{
                    findings: [
                        {
                            affectedThreads: 3,
                            id: 'external-agent-streams',
                            impactBytes: 3_145_728,
                            observedCount: 8,
                            recommendation: 'Use final-only JSON transport.',
                            severity: 'high',
                            title: 'External agent internals entered parent context',
                        },
                    ],
                    personaCandidates: [{ count: 4, label: 'audit capture runtime' }],
                    summary: {
                        broadReadCalls: 2,
                        externalAgentStreamBlocks: 8,
                        externalAgentStreamBytes: 3_145_728,
                        fullContextSpawns: 2,
                        genericSubagentSpawns: 4,
                        parentVisibleReasoningEvents: 120,
                        parentVisibleSubagentToolEvents: 20,
                        repeatedCheckCalls: 3,
                        repeatedCommandCalls: 5,
                        repeatedReadCalls: 2,
                        timedOutWaits: 4,
                        toolOutputBytes: 6_291_456,
                        truncatedOutputBytes: 1_048_576,
                        truncationBlocks: 2,
                    },
                }}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Optimization opportunities' })).toBeTruthy();
        expect(screen.getByText('External agent internals entered parent context')).toBeTruthy();
        expect(screen.getByText(/3\.0 MB retained/u)).toBeTruthy();
        expect(screen.getByText('Use final-only JSON transport.')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Candidate persona themes' })).toBeTruthy();
        expect(screen.getByText('audit capture runtime')).toBeTruthy();
        expect(screen.getByText('4 generic delegations')).toBeTruthy();
    });

    it('should show a clean state when no deterministic waste signals are present', () => {
        render(
            <OptimizationFindings
                optimization={{
                    findings: [],
                    personaCandidates: [],
                    summary: {
                        broadReadCalls: 0,
                        externalAgentStreamBlocks: 0,
                        externalAgentStreamBytes: 0,
                        fullContextSpawns: 0,
                        genericSubagentSpawns: 0,
                        parentVisibleReasoningEvents: 0,
                        parentVisibleSubagentToolEvents: 0,
                        repeatedCheckCalls: 0,
                        repeatedCommandCalls: 0,
                        repeatedReadCalls: 0,
                        timedOutWaits: 0,
                        toolOutputBytes: 0,
                        truncatedOutputBytes: 0,
                        truncationBlocks: 0,
                    },
                }}
            />,
        );

        expect(screen.getByText('No deterministic optimization findings in this scope.')).toBeTruthy();
    });
});
