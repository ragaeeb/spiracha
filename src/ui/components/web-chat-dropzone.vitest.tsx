import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebChatDropzone } from './web-chat-dropzone';

afterEach(cleanup);

describe('WebChatDropzone', () => {
    it('should accept multiple dropped JSON files', () => {
        const onFiles = vi.fn();
        const files = [
            new File(['{}'], 'chatgpt.json', { type: 'application/json' }),
            new File(['{}'], 'claude.json', { type: 'application/json' }),
        ];
        render(<WebChatDropzone disabled={false} onFiles={onFiles} />);

        const dropzone = screen.getByRole('group', { name: 'Web chat file drop zone' });
        fireEvent.dragOver(dropzone, { dataTransfer: { files } });
        expect(dropzone.className).toContain('border-[var(--accent)]');
        fireEvent.drop(dropzone, { dataTransfer: { files } });

        expect(onFiles).toHaveBeenCalledWith(files);
    });

    it('should support the native multi-file picker and disabled state', () => {
        const onFiles = vi.fn();
        const file = new File(['{}'], 'gemini.json', { type: 'application/json' });
        const { rerender } = render(<WebChatDropzone disabled={false} onFiles={onFiles} />);
        const input = screen.getByLabelText('Import web chat JSON files');

        expect(input.getAttribute('accept')).toContain('.json');
        expect(input.hasAttribute('multiple')).toBe(true);
        fireEvent.change(input, { target: { files: [file] } });
        expect(onFiles).toHaveBeenCalledWith([file]);

        rerender(<WebChatDropzone disabled onFiles={onFiles} />);
        expect(screen.getByLabelText('Import web chat JSON files').hasAttribute('disabled')).toBe(true);
        expect(screen.getByText('Importing chats…')).toBeTruthy();
    });
});
