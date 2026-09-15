import type { WebChatArtifact } from '@spiracha/lib/web-chat';
import { downloadTextFile } from '#/lib/download';
import { TextDocumentPanel } from './text-document-panel';
import { Button } from './ui/button';

export const WebChatArtifacts = ({ artifacts }: { artifacts: WebChatArtifact[] }) => (
    <div className="space-y-3">
        {artifacts.map((artifact, index) => {
            const isJson = /\.json$/i.test(artifact.title);
            const extension = isJson ? 'json' : 'md';
            const label = isJson ? 'JSON' : 'Markdown';
            return (
                <div className="space-y-2" key={artifact.id}>
                    <TextDocumentPanel
                        content={artifact.content}
                        description={`Generated artifact · ${label}`}
                        title={artifact.title}
                    />
                    <Button
                        variant="outline"
                        onClick={() =>
                            downloadTextFile(
                                `artifact-${index + 1}.${extension}`,
                                artifact.content,
                                isJson ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8',
                            )
                        }
                    >
                        Download {label}
                    </Button>
                </div>
            );
        })}
        {artifacts.length === 0 ? (
            <p className="text-[var(--muted-foreground)] text-sm">No artifacts in this import.</p>
        ) : null}
    </div>
);
