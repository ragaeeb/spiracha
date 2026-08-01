import { useId } from 'react';
import { Checkbox } from '#/components/ui/checkbox';

export type TranscriptControlsProps = {
    rawJsonDisabled?: boolean;
    showCommentary: boolean;
    showExtraEvents: boolean;
    showRawJson: boolean;
    showToolCalls: boolean;
    showUserMessages: boolean;
    onShowCommentaryChange: (checked: boolean) => void;
    onShowExtraEventsChange: (checked: boolean) => void;
    onShowRawJsonChange: (checked: boolean) => void;
    onShowToolCallsChange: (checked: boolean) => void;
    onShowUserMessagesChange: (checked: boolean) => void;
};

const TranscriptControl = ({
    checked,
    disabled,
    id,
    label,
    onChange,
}: {
    checked: boolean;
    disabled?: boolean;
    id: string;
    label: string;
    onChange: (checked: boolean) => void;
}) => (
    <div className="flex items-center gap-2 text-sm">
        <Checkbox checked={checked} disabled={disabled} id={id} onCheckedChange={(value) => onChange(value === true)} />
        <label htmlFor={id}>{label}</label>
    </div>
);

export const TranscriptControls = ({
    rawJsonDisabled = false,
    showCommentary,
    showExtraEvents,
    showRawJson,
    showToolCalls,
    showUserMessages,
    onShowCommentaryChange,
    onShowExtraEventsChange,
    onShowRawJsonChange,
    onShowToolCallsChange,
    onShowUserMessagesChange,
}: TranscriptControlsProps) => {
    const idPrefix = useId();

    return (
        <div className="flex flex-wrap gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2 shadow-[var(--panel-shadow)]">
            <TranscriptControl
                checked={showToolCalls}
                id={`${idPrefix}-tools`}
                label="Show tool calls"
                onChange={onShowToolCallsChange}
            />
            <TranscriptControl
                checked={showCommentary}
                id={`${idPrefix}-commentary`}
                label="Show commentary"
                onChange={onShowCommentaryChange}
            />
            <TranscriptControl
                checked={showExtraEvents}
                id={`${idPrefix}-extra`}
                label="Show extra events"
                onChange={onShowExtraEventsChange}
            />
            <TranscriptControl
                checked={showRawJson}
                disabled={rawJsonDisabled}
                id={`${idPrefix}-raw`}
                label="Raw JSON"
                onChange={onShowRawJsonChange}
            />
            <TranscriptControl
                checked={showUserMessages}
                id={`${idPrefix}-user`}
                label="User"
                onChange={onShowUserMessagesChange}
            />
        </div>
    );
};
