import type { WebChatArtifact } from '@spiracha/lib/web-chat';
import { downloadTextFile } from '#/lib/download';
import { TextDocumentPanel } from './text-document-panel';
import { Button } from './ui/button';

export const WebChatArtifacts = ({ artifacts }: { artifacts: WebChatArtifact[] }) => (
    <div className="space-y-3">
        {artifacts.map((artifact, index) => (
            <div className="space-y-2" key={artifact.id}>
                <TextDocumentPanel
                    content={artifact.content}
                    description="Generated artifact · Markdown"
                    title={artifact.title}
                />
                <Button
                    variant="outline"
                    onClick={() =>
                        downloadTextFile(`artifact-${index + 1}.md`, artifact.content, 'text/markdown;charset=utf-8')
                    }
                >
                    Download Markdown
                </Button>
            </div>
        ))}
        {artifacts.length === 0 ? (
            <p className="text-[var(--muted-foreground)] text-sm">No artifacts in this import.</p>
        ) : null}
    </div>
);
