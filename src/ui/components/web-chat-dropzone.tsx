import { Upload } from 'lucide-react';
import { type ChangeEvent, type DragEvent, useState } from 'react';
import { cn } from '#/lib/utils';

type WebChatDropzoneProps = {
    disabled: boolean;
    onFiles: (files: File[]) => void;
};

export const WebChatDropzone = ({ disabled, onFiles }: WebChatDropzoneProps) => {
    const [dragging, setDragging] = useState(false);
    const selectFiles = (files: FileList | File[]) => {
        const selected = Array.from(files);
        if (!disabled && selected.length > 0) {
            onFiles(selected);
        }
    };
    const handleDrop = (event: DragEvent<HTMLFieldSetElement>) => {
        event.preventDefault();
        setDragging(false);
        selectFiles(event.dataTransfer.files);
    };
    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
        selectFiles(event.target.files ?? []);
        event.target.value = '';
    };

    return (
        <fieldset
            aria-label="Web chat file drop zone"
            className={cn(
                'rounded-2xl border-2 border-[var(--border)] border-dashed bg-[var(--panel)] p-8 text-center transition-colors',
                dragging && 'border-[var(--accent)] bg-[var(--accent-muted)]/40',
            )}
            onDragEnter={(event) => {
                event.preventDefault();
                if (!disabled) {
                    setDragging(true);
                }
            }}
            onDragLeave={() => setDragging(false)}
            onDragOver={(event) => {
                event.preventDefault();
                if (!disabled) {
                    setDragging(true);
                }
            }}
            onDrop={handleDrop}
        >
            <Upload aria-hidden="true" className="mx-auto size-8 text-[var(--accent)]" />
            <p className="mt-3 font-semibold">{disabled ? 'Importing chats…' : 'Drop exported chats here'}</p>
            <p className="mt-1 text-[var(--muted-foreground)] text-sm">
                ChatGPT, Claude, Gemini, Grok, Qwen, GLM, and compatible JSON exports.
            </p>
            <label className="mt-4 inline-flex cursor-pointer rounded-full border border-[var(--border)] px-4 py-2 font-medium text-sm transition-colors hover:bg-[var(--panel-secondary)]">
                Choose JSON files
                <input
                    aria-label="Import web chat JSON files"
                    className="sr-only"
                    accept=".json,application/json"
                    disabled={disabled}
                    multiple
                    type="file"
                    onChange={handleChange}
                />
            </label>
        </fieldset>
    );
};
