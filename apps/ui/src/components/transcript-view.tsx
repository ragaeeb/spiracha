import type { ThreadEvent } from '@spiracha/lib/codex-browser-types';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, Copy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import { Checkbox } from '#/components/ui/checkbox';
import { formatDateTime, formatModelLabel } from '#/lib/formatters';
import { applyPathTransforms } from '#/lib/path-utils';
import { useSettings } from '#/lib/settings-store';
import { cn } from '#/lib/utils';

type TranscriptViewProps = {
    activeEventJumpSignal?: number;
    activeEventKey?: string | null;
    assistantModel: string | null;
    events: ThreadEvent[];
    projectPath: string | null;
    showCommentary: boolean;
    showExtraEvents: boolean;
    showRawJson: boolean;
    showToolCalls: boolean;
    showUserMessages?: boolean;
};

const isCommentaryMessage = (event: ThreadEvent) =>
    event.kind === 'message' && event.role === 'assistant' && event.phase === 'commentary';

export const shouldShowEvent = (
    event: ThreadEvent,
    showToolCalls: boolean,
    showExtraEvents: boolean,
    showCommentary: boolean,
    showUserMessages: boolean,
) => {
    if (isCommentaryMessage(event) && !showCommentary) {
        return false;
    }

    if (event.kind === 'message') {
        if (event.role === 'user' && !showUserMessages) {
            return false;
        }

        return !event.isHiddenByDefault || showExtraEvents;
    }

    if (event.kind === 'tool_call' || event.kind === 'tool_output') {
        return showToolCalls;
    }

    return showExtraEvents;
};

const getEventTone = (event: ThreadEvent) => {
    if (event.kind === 'message' && event.role === 'assistant') {
        return 'border-[var(--accent)]/40 bg-[var(--panel)]';
    }

    if (event.kind === 'message' && event.role === 'user') {
        return 'border-[var(--border)] bg-[var(--panel-secondary)]';
    }

    if (event.kind === 'tool_call' || event.kind === 'tool_output') {
        return 'border-[var(--border)] bg-[var(--code-background)]';
    }

    return 'border-[var(--border)] bg-[var(--panel-secondary)]/80';
};

const getMessageTitle = (event: Extract<ThreadEvent, { kind: 'message' }>, assistantModel: string | null) => {
    const modelLabel = formatModelLabel(event.model ?? assistantModel);

    if (event.variant === 'agent_message') {
        return event.role === 'assistant' ? modelLabel : 'Assistant update';
    }

    if (event.role === 'assistant') {
        return modelLabel;
    }

    return event.role === 'system' ? 'System' : 'User';
};

const assertNever = (value: never): never => {
    throw new Error(`Unhandled transcript event kind: ${JSON.stringify(value)}`);
};

const getNonMessageTitle = (event: Exclude<ThreadEvent, { kind: 'message' }>) => {
    switch (event.kind) {
        case 'tool_call':
            return `Tool call: ${event.name}`;
        case 'tool_output':
            return 'Tool output';
        case 'task_started':
            return 'Task started';
        case 'task_complete':
            return 'Task complete';
        case 'token_count':
            return 'Token update';
        case 'reasoning':
            return 'Reasoning';
        case 'web_search':
            return 'Web search';
        default:
            return assertNever(event);
    }
};

const getEventTitle = (event: ThreadEvent, assistantModel: string | null) =>
    event.kind === 'message' ? getMessageTitle(event, assistantModel) : getNonMessageTitle(event);

type Transform = (text: string) => string;

const copyToClipboard = async (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {}
    }

    return false;
};

const getEventMarkdownBody = (event: ThreadEvent, transform: Transform) => {
    switch (event.kind) {
        case 'message':
            return transform(event.text || 'No text content');
        case 'tool_call':
            return [event.command ?? event.name, event.workdir]
                .filter((value): value is string => Boolean(value))
                .map(transform)
                .join('\n\n');
        case 'tool_output':
            return transform(event.summary || event.outputText || '');
        case 'task_started':
            return `Context window: ${event.modelContextWindow ?? 'n/a'}\n\nCollaboration mode: ${event.collaborationModeKind ?? 'n/a'}`;
        case 'task_complete':
            return `Duration: ${event.durationMs ?? 'n/a'} ms\n\nFirst token: ${event.timeToFirstTokenMs ?? 'n/a'} ms`;
        case 'token_count':
            return JSON.stringify(event.rateLimits, null, 2);
        case 'reasoning':
            return event.summary.join(' ') || 'Reasoning content is not directly available.';
        case 'web_search':
            return [
                `Phase: ${event.phase}${event.status ? ` · ${event.status}` : ''}`,
                event.query ? transform(event.query) : null,
            ]
                .filter(Boolean)
                .join('\n\n');
    }
};

const getEventMarkdown = (event: ThreadEvent, assistantModel: string | null, transform: Transform) =>
    `## ${getEventTitle(event, assistantModel)}\n\n${getEventMarkdownBody(event, transform)}`;

export const getTranscriptEventKey = (event: ThreadEvent, index: number) => {
    if (event.kind === 'tool_call') {
        return `${event.kind}-${event.sequence}-${event.callId ?? event.timestamp ?? event.name}-${index}`;
    }

    if (event.kind === 'tool_output') {
        return `${event.kind}-${event.sequence}-${event.callId ?? event.timestamp ?? 'output'}-${index}`;
    }

    if (event.kind === 'message') {
        return `${event.kind}-${event.sequence}-${event.variant}-${event.timestamp ?? event.role}-${index}`;
    }

    return `${event.kind}-${event.sequence}-${event.timestamp ?? 'event'}-${index}`;
};

const renderMessageBody = (event: Extract<ThreadEvent, { kind: 'message' }>, t: Transform) => (
    <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
        {t(event.text || 'No text content')}
    </p>
);

const renderToolCallBody = (event: Extract<ThreadEvent, { kind: 'tool_call' }>, t: Transform) => (
    <div className="space-y-2 text-sm">
        <p className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{t(event.command ?? event.name)}</p>
        {event.workdir ? <p className="font-mono text-[var(--muted-foreground)] text-xs">{t(event.workdir)}</p> : null}
    </div>
);

const renderToolOutputBody = (event: Extract<ThreadEvent, { kind: 'tool_output' }>, t: Transform) => (
    <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
        {t(event.summary || event.outputText || '')}
    </p>
);

const renderTaskStartedBody = (event: Extract<ThreadEvent, { kind: 'task_started' }>) => (
    <div className="text-[var(--muted-foreground)] text-sm">
        Context window: {event.modelContextWindow ?? 'n/a'} · Collaboration mode: {event.collaborationModeKind ?? 'n/a'}
    </div>
);

const renderTaskCompleteBody = (event: Extract<ThreadEvent, { kind: 'task_complete' }>) => (
    <div className="text-[var(--muted-foreground)] text-sm">
        Duration: {event.durationMs ?? 'n/a'} ms · First token: {event.timeToFirstTokenMs ?? 'n/a'} ms
    </div>
);

const renderTokenCountBody = (event: Extract<ThreadEvent, { kind: 'token_count' }>) => (
    <pre className="overflow-x-auto text-xs leading-5">{JSON.stringify(event.rateLimits, null, 2)}</pre>
);

const renderReasoningBody = (event: Extract<ThreadEvent, { kind: 'reasoning' }>) => (
    <div className="space-y-2 text-sm">
        <p>{event.summary.join(' ') || 'Reasoning content is not directly available.'}</p>
        {event.hasEncryptedContent ? (
            <p className="text-[var(--muted-foreground)] text-xs">Encrypted reasoning payload captured.</p>
        ) : null}
    </div>
);

const renderWebSearchBody = (event: Extract<ThreadEvent, { kind: 'web_search' }>) => (
    <div className="space-y-2 text-sm">
        <p>
            Phase: {event.phase}
            {event.status ? ` · ${event.status}` : ''}
        </p>
        {event.query ? <p className="text-[var(--muted-foreground)]">{event.query}</p> : null}
    </div>
);

const renderEventBody = (event: ThreadEvent, t: Transform) => {
    switch (event.kind) {
        case 'message':
            return renderMessageBody(event, t);
        case 'tool_call':
            return renderToolCallBody(event, t);
        case 'tool_output':
            return renderToolOutputBody(event, t);
        case 'task_started':
            return renderTaskStartedBody(event);
        case 'task_complete':
            return renderTaskCompleteBody(event);
        case 'token_count':
            return renderTokenCountBody(event);
        case 'reasoning':
            return renderReasoningBody(event);
        case 'web_search':
            return renderWebSearchBody(event);
    }
};

type TranscriptEventCardProps = {
    assistantModel: string | null;
    copied: boolean;
    event: ThreadEvent;
    eventKey: string;
    isActive: boolean;
    isSelected: boolean;
    showRawJson: boolean;
    transform: Transform;
    onCardElement: (eventKey: string, element: HTMLElement | null) => void;
    onCopy: (event: ThreadEvent) => void;
    onSelectionChange: (event: ThreadEvent, checked: boolean) => void;
};

function TranscriptEventCard({
    assistantModel,
    copied,
    event,
    eventKey,
    isActive,
    isSelected,
    showRawJson,
    transform,
    onCardElement,
    onCopy,
    onSelectionChange,
}: TranscriptEventCardProps) {
    return (
        <article
            ref={(element) => onCardElement(eventKey, element)}
            aria-current={isActive ? 'location' : undefined}
            className={cn(
                'min-w-0 scroll-mt-24 overflow-hidden rounded-xl border p-3.5 shadow-[var(--panel-shadow)]',
                isSelected && 'ring-2 ring-[var(--accent)]/35',
                isActive && 'ring-2 ring-[var(--accent)]',
                getEventTone(event),
            )}
            data-transcript-event-key={eventKey}
        >
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <Checkbox
                        aria-label={`Select ${getEventTitle(event, assistantModel)}`}
                        checked={isSelected}
                        onCheckedChange={(checked) => onSelectionChange(event, checked === true)}
                    />
                    <h3 className="min-w-0 break-words font-semibold text-sm [overflow-wrap:anywhere]">
                        {getEventTitle(event, assistantModel)}
                    </h3>
                    {event.kind === 'message' && event.phase ? <Badge variant="outline">{event.phase}</Badge> : null}
                    {event.kind !== 'message' ? (
                        <Badge variant="outline">{event.kind.replaceAll('_', ' ')}</Badge>
                    ) : null}
                </div>
                {event.timestamp ? (
                    <p className="shrink-0 text-[var(--muted-foreground)] text-xs" suppressHydrationWarning>
                        {formatDateTime(event.timestamp)}
                    </p>
                ) : null}
            </div>
            <div className="mt-2.5 min-w-0">{renderEventBody(event, transform)}</div>
            <div className="mt-3 flex justify-end">
                <Button
                    aria-label="Copy message"
                    className="text-[var(--muted-foreground)] hover:bg-[var(--panel-secondary)] hover:text-[var(--foreground)]"
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => onCopy(event)}
                >
                    {copied ? <Check className="text-[var(--accent)]" /> : <Copy />}
                </Button>
            </div>
            {showRawJson ? (
                <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--code-background)] p-3 text-[var(--code-foreground)] text-xs leading-5">
                    {JSON.stringify(event.raw, null, 2)}
                </pre>
            ) : null}
        </article>
    );
}

export function TranscriptView({
    activeEventJumpSignal = 0,
    activeEventKey = null,
    assistantModel,
    events,
    projectPath,
    showCommentary,
    showExtraEvents,
    showRawJson,
    showToolCalls,
    showUserMessages = true,
}: TranscriptViewProps) {
    const { settings } = useSettings();
    const visibleEvents = useMemo(
        () =>
            events.filter((event) =>
                shouldShowEvent(event, showToolCalls, showExtraEvents, showCommentary, showUserMessages),
            ),
        [events, showCommentary, showExtraEvents, showToolCalls, showUserMessages],
    );
    const [copiedEventKeys, setCopiedEventKeys] = useState<string[]>([]);
    const [copiedSelection, setCopiedSelection] = useState(false);
    const [copyErrorMessage, setCopyErrorMessage] = useState<string | null>(null);
    const [selectedEventKeys, setSelectedEventKeys] = useState<string[]>([]);
    const eventElementByKeyRef = useRef(new Map<string, HTMLElement>());
    const lastHandledJumpSignalRef = useRef<number | null>(null);
    const parentRef = useRef<HTMLDivElement | null>(null);
    const timeoutIdsRef = useRef<number[]>([]);
    const useVirtualList = visibleEvents.length > 40;
    const eventKeyByEvent = useMemo(
        () => new Map(events.map((event, index) => [event, getTranscriptEventKey(event, index)])),
        [events],
    );
    const getEventKey = (event: ThreadEvent) => eventKeyByEvent.get(event) ?? getTranscriptEventKey(event, -1);
    const transform = (text: string) => applyPathTransforms(text, settings, projectPath);
    const visibleEventKeys = useMemo(
        () => visibleEvents.map((event) => eventKeyByEvent.get(event) ?? getTranscriptEventKey(event, -1)),
        [visibleEvents, eventKeyByEvent],
    );
    const visibleEventKeySet = useMemo(() => new Set(visibleEventKeys), [visibleEventKeys]);
    const activeVisibleEventIndex = useMemo(
        () => (activeEventKey ? visibleEventKeys.indexOf(activeEventKey) : -1),
        [activeEventKey, visibleEventKeys],
    );
    const selectedEventKeySet = useMemo(() => new Set(selectedEventKeys), [selectedEventKeys]);
    const virtualizer = useVirtualizer({
        count: useVirtualList ? visibleEvents.length : 0,
        estimateSize: () => 160,
        getItemKey: (index) => getEventKey(visibleEvents[index]!) ?? `event-${index}`,
        getScrollElement: () => parentRef.current,
        measureElement: (element) => element.getBoundingClientRect().height,
        overscan: 8,
    });

    const handleCardElement = (eventKey: string, element: HTMLElement | null) => {
        if (element) {
            eventElementByKeyRef.current.set(eventKey, element);
            return;
        }

        eventElementByKeyRef.current.delete(eventKey);
    };

    useEffect(() => {
        return () => {
            for (const timeoutId of timeoutIdsRef.current) {
                window.clearTimeout(timeoutId);
            }
            timeoutIdsRef.current = [];
        };
    }, []);

    useEffect(() => {
        setSelectedEventKeys((current) => {
            const next = current.filter((key) => visibleEventKeySet.has(key));
            return next.length === current.length ? current : next;
        });
    }, [visibleEventKeySet]);

    useEffect(() => {
        if (!Number.isFinite(activeEventJumpSignal) || !activeEventKey || activeVisibleEventIndex < 0) {
            return;
        }

        if (lastHandledJumpSignalRef.current === activeEventJumpSignal) {
            return;
        }
        lastHandledJumpSignalRef.current = activeEventJumpSignal;

        if (useVirtualList) {
            virtualizer.scrollToIndex(activeVisibleEventIndex, { align: 'start' });
            return;
        }

        eventElementByKeyRef.current.get(activeEventKey)?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }, [activeEventJumpSignal, activeEventKey, activeVisibleEventIndex, useVirtualList, virtualizer]);

    const scheduleTimeout = (callback: () => void, delayMs: number) => {
        const timeoutId = window.setTimeout(() => {
            timeoutIdsRef.current = timeoutIdsRef.current.filter((entry) => entry !== timeoutId);
            callback();
        }, delayMs);
        timeoutIdsRef.current.push(timeoutId);
    };

    const showCopyFailure = () => {
        setCopyErrorMessage('Copy failed');
        scheduleTimeout(() => {
            setCopyErrorMessage((current) => (current === 'Copy failed' ? null : current));
        }, 1500);
    };

    const visibleSelectedKeys = useMemo(
        () => selectedEventKeys.filter((key) => visibleEventKeySet.has(key)),
        [selectedEventKeys, visibleEventKeySet],
    );
    const visibleSelectedKeySet = useMemo(() => new Set(visibleSelectedKeys), [visibleSelectedKeys]);
    const allVisibleSelected = visibleEvents.length > 0 && visibleSelectedKeys.length === visibleEvents.length;

    const handleSelectionChange = (event: ThreadEvent, checked: boolean) => {
        const key = getEventKey(event);
        setSelectedEventKeys((current) =>
            checked ? (current.includes(key) ? current : [...current, key]) : current.filter((entry) => entry !== key),
        );
    };

    const handleToggleAllVisible = (checked: boolean) => {
        setSelectedEventKeys((current) =>
            checked
                ? [...new Set([...current.filter((key) => !visibleEventKeySet.has(key)), ...visibleEventKeys])]
                : current.filter((key) => !visibleEventKeySet.has(key)),
        );
    };

    const handleCopyEvent = async (event: ThreadEvent) => {
        const copied = await copyToClipboard(getEventMarkdown(event, assistantModel, transform));
        if (!copied) {
            showCopyFailure();
            return;
        }

        const key = getEventKey(event);
        setCopiedEventKeys((current) => [...new Set([...current, key])]);
        scheduleTimeout(() => {
            setCopiedEventKeys((current) => current.filter((entry) => entry !== key));
        }, 1500);
    };

    const handleCopySelected = async () => {
        const selectedEvents = visibleEvents.filter((event) => visibleSelectedKeySet.has(getEventKey(event)));
        if (selectedEvents.length === 0) {
            return;
        }

        const copied = await copyToClipboard(
            selectedEvents.map((event) => getEventMarkdown(event, assistantModel, transform)).join('\n\n'),
        );
        if (!copied) {
            showCopyFailure();
            return;
        }

        setCopiedSelection(true);
        scheduleTimeout(() => {
            setCopiedSelection(false);
        }, 1500);
    };

    if (useVirtualList) {
        return (
            <div
                ref={parentRef}
                className="h-[70vh] overflow-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3"
            >
                <div className="sticky top-0 z-10 mb-3 flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--panel)]/95 px-3 py-2 backdrop-blur">
                    <div className="flex items-center gap-2">
                        <Checkbox
                            aria-label="Select visible messages"
                            checked={allVisibleSelected}
                            onCheckedChange={(checked) => handleToggleAllVisible(checked === true)}
                        />
                        <span className="text-[var(--muted-foreground)] text-sm">
                            {visibleSelectedKeys.length} selected
                        </span>
                        {copyErrorMessage ? (
                            <span className="text-[var(--destructive)] text-sm">{copyErrorMessage}</span>
                        ) : null}
                    </div>
                    <Button
                        aria-label="Copy selected messages"
                        className="hover:bg-[var(--panel-secondary)] hover:text-[var(--foreground)]"
                        disabled={visibleSelectedKeys.length === 0}
                        size="sm"
                        variant="outline"
                        onClick={() => void handleCopySelected()}
                    >
                        {copiedSelection ? <Check className="text-[var(--accent)]" /> : <Copy />}
                        {copiedSelection ? 'Copied' : 'Copy'}
                    </Button>
                </div>
                <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
                    {virtualizer.getVirtualItems().map((item) => (
                        <div
                            key={item.key}
                            ref={virtualizer.measureElement}
                            data-index={item.index}
                            className="absolute top-0 left-0 w-full pb-3.5"
                            style={{ transform: `translateY(${item.start}px)` }}
                        >
                            <TranscriptEventCard
                                assistantModel={assistantModel}
                                copied={copiedEventKeys.includes(getEventKey(visibleEvents[item.index]!))}
                                event={visibleEvents[item.index]!}
                                eventKey={getEventKey(visibleEvents[item.index]!)}
                                isActive={activeEventKey === getEventKey(visibleEvents[item.index]!)}
                                isSelected={selectedEventKeySet.has(getEventKey(visibleEvents[item.index]!))}
                                showRawJson={showRawJson}
                                transform={transform}
                                onCardElement={handleCardElement}
                                onCopy={(event) => void handleCopyEvent(event)}
                                onSelectionChange={handleSelectionChange}
                            />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-3.5">
            <div className="sticky top-0 z-10 flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--panel)]/95 px-3 py-2 backdrop-blur">
                <div className="flex items-center gap-2">
                    <Checkbox
                        aria-label="Select visible messages"
                        checked={allVisibleSelected}
                        onCheckedChange={(checked) => handleToggleAllVisible(checked === true)}
                    />
                    <span className="text-[var(--muted-foreground)] text-sm">
                        {visibleSelectedKeys.length} selected
                    </span>
                    {copyErrorMessage ? (
                        <span className="text-[var(--destructive)] text-sm">{copyErrorMessage}</span>
                    ) : null}
                </div>
                <Button
                    aria-label="Copy selected messages"
                    className="hover:bg-[var(--panel-secondary)] hover:text-[var(--foreground)]"
                    disabled={visibleSelectedKeys.length === 0}
                    size="sm"
                    variant="outline"
                    onClick={() => void handleCopySelected()}
                >
                    {copiedSelection ? <Check className="text-[var(--accent)]" /> : <Copy />}
                    {copiedSelection ? 'Copied' : 'Copy'}
                </Button>
            </div>
            {visibleEvents.map((event) => (
                <TranscriptEventCard
                    assistantModel={assistantModel}
                    copied={copiedEventKeys.includes(getEventKey(event))}
                    event={event}
                    eventKey={getEventKey(event)}
                    key={getEventKey(event)}
                    isActive={activeEventKey === getEventKey(event)}
                    isSelected={selectedEventKeySet.has(getEventKey(event))}
                    showRawJson={showRawJson}
                    transform={transform}
                    onCardElement={handleCardElement}
                    onCopy={(selectedEvent) => void handleCopyEvent(selectedEvent)}
                    onSelectionChange={handleSelectionChange}
                />
            ))}
        </div>
    );
}
