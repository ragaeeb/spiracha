import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tabs, TabsList, TabsTrigger } from './tabs';

describe('Tabs', () => {
    it('should render rounded pill tabs without height clipping constraints', () => {
        render(
            <Tabs defaultValue="transcript">
                <TabsList>
                    <TabsTrigger value="transcript">Transcript</TabsTrigger>
                    <TabsTrigger value="metadata">Metadata</TabsTrigger>
                    <TabsTrigger value="raw">Raw</TabsTrigger>
                </TabsList>
            </Tabs>,
        );

        const tabsList = screen.getByRole('tablist');
        expect(tabsList.className).not.toContain('overflow-hidden');
        expect(tabsList.className).not.toContain('h-9');
        expect(tabsList.className).toContain('min-h-11');

        const transcriptTab = screen.getByRole('tab', { name: 'Transcript' });
        expect(transcriptTab.className).toContain('h-auto');
        expect(transcriptTab.className).toContain('py-2');
    });
});
