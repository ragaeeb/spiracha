import { validateEvidenceLens } from '@spiracha/lib/conversation-data/evidence-lens';
import type {
    ConversationEvidenceExport,
    ConversationSource,
    EvidenceLens,
} from '@spiracha/lib/conversation-data/types';

type EvidenceTarget = { id: string; merged?: boolean; source: ConversationSource };

export const requestEvidenceExport = async (
    target: EvidenceTarget,
    lens: EvidenceLens,
    fetchImpl: typeof fetch = fetch,
): Promise<ConversationEvidenceExport> => {
    const validation = validateEvidenceLens(lens);
    if (!validation.ok) {
        const path = validation.error.path ? `lens.${validation.error.path}` : 'lens';
        throw new Error(`Invalid evidence lens at ${path}: ${validation.error.message}`);
    }
    const search = target.merged ? '?merged=true' : '';
    const response = await fetchImpl(
        `/api/v1/conversations/${target.source}/${encodeURIComponent(target.id)}/evidence${search}`,
        {
            body: JSON.stringify({ lens: validation.value }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
        },
    );
    let body: { data?: ConversationEvidenceExport; error?: { message?: string } };
    try {
        body = (await response.json()) as typeof body;
    } catch {
        throw new Error(`Focused evidence request returned invalid JSON (${response.status}).`);
    }
    if (!response.ok) {
        throw new Error(body.error?.message || `Focused evidence request failed (${response.status}).`);
    }
    if (!body.data) {
        throw new Error('Focused evidence response did not include export data.');
    }
    return body.data;
};
