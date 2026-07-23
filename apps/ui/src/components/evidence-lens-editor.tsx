import { DEFAULT_EVIDENCE_LENS, validateEvidenceLens } from '@spiracha/lib/conversation-data/evidence-lens';
import type { EvidenceAnchor, EvidenceLens } from '@spiracha/lib/conversation-data/types';
import { useState } from 'react';
import { Button } from '#/components/ui/button';
import { Checkbox } from '#/components/ui/checkbox';

type EvidenceLensEditorProps = {
    lens: EvidenceLens;
    onChange: (lens: EvidenceLens) => void;
};

const fieldClass =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--panel-secondary)] px-3 py-2 text-sm text-[var(--foreground)]';

const anchorLabel = (anchor: EvidenceAnchor) => {
    if (anchor.kind === 'tool') {
        return `Tool: ${anchor.names?.join(', ') || '*'} / ${anchor.namespaces?.join(', ') || '*'}`;
    }
    if (anchor.kind === 'shell-command') {
        return `Shell: ${anchor.executables.join(', ')} ${anchor.subcommands?.join(', ') || ''}`;
    }
    if (anchor.kind === 'schema') {
        return `Schema: ${anchor.prefixes.join(', ')}`;
    }
    if (anchor.kind === 'text') {
        return `Text: ${anchor.literals.join(', ')}`;
    }
    return `${anchor.kind === 'cwd' ? 'CWD' : 'Artifact'}: ${anchor.globs.join(', ')}`;
};

export const EvidenceLensEditor = ({ lens, onChange }: EvidenceLensEditorProps) => {
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [json, setJson] = useState(JSON.stringify(lens, null, 2));
    const [jsonError, setJsonError] = useState<string | null>(null);
    const setDraft = (key: string, value: string) => setDrafts((current) => ({ ...current, [key]: value }));
    const addAnchor = (anchor: EvidenceAnchor) => {
        const serialized = JSON.stringify(anchor);
        if (!lens.anchors.some((candidate) => JSON.stringify(candidate) === serialized)) {
            onChange({ ...lens, anchors: [...lens.anchors, anchor] });
        }
        setDrafts({});
    };
    const addValueAnchor = (key: string, build: (value: string) => EvidenceAnchor) => {
        const value = drafts[key]?.trim();
        if (value) {
            addAnchor(build(value));
        }
    };
    const updateContext = <K extends keyof EvidenceLens['context']>(key: K, value: EvidenceLens['context'][K]) =>
        onChange({ ...lens, context: { ...lens.context, [key]: value } });
    const updateBudget = <K extends keyof EvidenceLens['budget']>(key: K, value: number) =>
        onChange({ ...lens, budget: { ...lens.budget, [key]: value } });
    const importJson = () => {
        try {
            const parsed: unknown = JSON.parse(json);
            const result = validateEvidenceLens(parsed);
            if (!result.ok) {
                setJsonError(`${result.error.path || 'lens'}: ${result.error.message}`);
                return;
            }
            onChange(result.value);
            setJsonError(null);
        } catch {
            setJsonError('Lens JSON is not valid JSON.');
        }
    };

    return (
        <div className="space-y-4" data-testid="evidence-lens-editor">
            <label className="block space-y-1 text-sm">
                <span className="font-medium">Lens name</span>
                <input
                    className={fieldClass}
                    value={lens.name}
                    onChange={(event) => onChange({ ...lens, name: event.target.value })}
                />
            </label>

            <div className="space-y-2">
                <span className="font-medium text-sm">Anchors (OR)</span>
                <div className="space-y-1">
                    {lens.anchors.map((anchor, index) => (
                        <div
                            className="flex items-center justify-between gap-2 rounded-lg bg-[var(--panel-secondary)] p-2 text-sm"
                            key={JSON.stringify(anchor)}
                        >
                            <span>{anchorLabel(anchor)}</span>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                    onChange({
                                        ...lens,
                                        anchors: lens.anchors.filter((_item, itemIndex) => itemIndex !== index),
                                    })
                                }
                            >
                                Remove
                            </Button>
                        </div>
                    ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                    <input
                        aria-label="Tool name"
                        className={fieldClass}
                        placeholder="Tool name"
                        value={drafts.tool ?? ''}
                        onChange={(event) => setDraft('tool', event.target.value)}
                    />
                    <input
                        aria-label="Tool namespace"
                        className={fieldClass}
                        placeholder="Namespace (optional)"
                        value={drafts.namespace ?? ''}
                        onChange={(event) => setDraft('namespace', event.target.value)}
                    />
                    <Button
                        variant="outline"
                        onClick={() => {
                            const name = drafts.tool?.trim();
                            const namespace = drafts.namespace?.trim();
                            if (name || namespace) {
                                addAnchor({
                                    kind: 'tool',
                                    ...(name ? { names: [name] } : {}),
                                    ...(namespace ? { namespaces: [namespace] } : {}),
                                });
                            }
                        }}
                    >
                        Add tool anchor
                    </Button>
                    <span />
                    <input
                        aria-label="Executable"
                        className={fieldClass}
                        placeholder="Executable"
                        value={drafts.executable ?? ''}
                        onChange={(event) => setDraft('executable', event.target.value)}
                    />
                    <input
                        aria-label="Subcommand"
                        className={fieldClass}
                        placeholder="Subcommand (optional)"
                        value={drafts.subcommand ?? ''}
                        onChange={(event) => setDraft('subcommand', event.target.value)}
                    />
                    <Button
                        variant="outline"
                        onClick={() => {
                            const executable = drafts.executable?.trim();
                            const subcommand = drafts.subcommand?.trim();
                            if (executable) {
                                addAnchor({
                                    executables: [executable],
                                    kind: 'shell-command',
                                    ...(subcommand ? { subcommands: [subcommand] } : {}),
                                });
                            }
                        }}
                    >
                        Add shell anchor
                    </Button>
                    <span />
                    {(
                        [
                            ['artifact', 'Artifact glob'],
                            ['cwd', 'CWD glob'],
                            ['schema', 'Schema prefix'],
                            ['text', 'Literal text'],
                        ] as const
                    ).map(([kind, label]) => (
                        <div className="flex gap-2" key={kind}>
                            <input
                                aria-label={label}
                                className={fieldClass}
                                placeholder={label}
                                value={drafts[kind] ?? ''}
                                onChange={(event) => setDraft(kind, event.target.value)}
                            />
                            <Button
                                variant="outline"
                                onClick={() =>
                                    addValueAnchor(kind, (value) =>
                                        kind === 'schema'
                                            ? { kind, prefixes: [value] }
                                            : kind === 'text'
                                              ? { kind, literals: [value] }
                                              : { globs: [value], kind },
                                    )
                                }
                            >
                                Add
                            </Button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                {(['commentaryBefore', 'commentaryAfter', 'maxOrderGap'] as const).map((field) => (
                    <label className="space-y-1 text-sm" key={field}>
                        <span>{field}</span>
                        <input
                            className={fieldClass}
                            min={field === 'maxOrderGap' ? 1 : 0}
                            type="number"
                            value={lens.context[field]}
                            onChange={(event) => updateContext(field, Number(event.target.value))}
                        />
                    </label>
                ))}
                {(
                    [
                        'totalCharacters',
                        'successfulOutputCharacters',
                        'failedOutputCharacters',
                        'commentaryCharactersPerEpisode',
                    ] as const
                ).map((field) => (
                    <label className="space-y-1 text-sm" key={field}>
                        <span>{field}</span>
                        <input
                            className={fieldClass}
                            min={0}
                            type="number"
                            value={lens.budget[field]}
                            onChange={(event) => updateBudget(field, Number(event.target.value))}
                        />
                    </label>
                ))}
            </div>
            {(['includeReasoningSummaries', 'followRetries', 'followWorkarounds'] as const).map((field) => (
                <div className="flex items-center gap-2 text-sm" key={field}>
                    <Checkbox
                        id={`evidence-${field}`}
                        checked={lens.context[field]}
                        onCheckedChange={(checked) => updateContext(field, checked === true)}
                    />
                    <label htmlFor={`evidence-${field}`}>{field}</label>
                </div>
            ))}

            <div className="space-y-2">
                <label className="font-medium text-sm" htmlFor="evidence-lens-json">
                    Lens JSON
                </label>
                <textarea
                    id="evidence-lens-json"
                    className={`${fieldClass} min-h-32 font-mono`}
                    value={json}
                    onChange={(event) => setJson(event.target.value)}
                />
                <div className="flex gap-2">
                    <Button variant="outline" onClick={importJson}>
                        Import lens JSON
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => {
                            setJson(JSON.stringify(lens, null, 2));
                            setJsonError(null);
                        }}
                    >
                        Export lens JSON
                    </Button>
                    <Button variant="ghost" onClick={() => onChange(DEFAULT_EVIDENCE_LENS)}>
                        Reset
                    </Button>
                </div>
                {jsonError ? <p className="text-[var(--destructive)] text-sm">{jsonError}</p> : null}
            </div>
        </div>
    );
};
