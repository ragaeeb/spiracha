import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { downloadTextFile } from '#/lib/download';
import { WebChatArtifacts } from './web-chat-artifacts';

vi.mock('#/lib/download', () => ({ downloadTextFile: vi.fn() }));
afterEach(cleanup);

it('should preview the artifact and download its unchanged Markdown', () => {
    const content = '# Research report\n\nArabic: رحمه الله\n';
    render(<WebChatArtifacts artifacts={[{ content, id: 'im_report', title: 'Research report' }]} />);
    expect(screen.getByText(/# Research report/).textContent).toBe(content);
    fireEvent.click(screen.getByRole('button', { name: 'Download Markdown' }));
    expect(downloadTextFile).toHaveBeenCalledWith('artifact-1.md', content, 'text/markdown;charset=utf-8');
});
