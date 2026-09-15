import { DEFAULT_EVIDENCE_LENS } from '@spiracha/lib/conversation-data/evidence-lens';
import { describe, expect, it, vi } from 'vitest';
import { requestEvidenceExport } from './evidence-export';

const target = { id: 'space/and?unicode=会', source: 'codex' as const };
const jsonFetch = (body: unknown, status = 200) =>
    vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));

describe('focused evidence HTTP boundaries', () => {
    it('should reject an invalid lens before making a network request', async () => {
        const fetchImpl = jsonFetch({ data: {} });
        await expect(requestEvidenceExport(target, { ...DEFAULT_EVIDENCE_LENS, anchors: [] }, fetchImpl))
            .rejects.toThrow('lens.anchors');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('should encode the reference and submit a validated lens without mutating it', async () => {
        const lens = structuredClone(DEFAULT_EVIDENCE_LENS);
        const before = structuredClone(lens);
        const data = { markdown: '# Focused evidence', summary: {} };
        const fetchImpl = jsonFetch({ data });
        expect(await requestEvidenceExport(target, lens, fetchImpl)).toEqual(data);
        expect(fetchImpl).toHaveBeenCalledWith(
            '/api/v1/conversations/codex/space%2Fand%3Funicode%3D%E4%BC%9A/evidence',
            {
                body: JSON.stringify({ lens }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            },
        );
        expect(lens).toEqual(before);
    });

    it.each([null, [], 'unexpected', 42])('should reject a malformed envelope: %j', async (body) => {
        await expect(requestEvidenceExport(target, DEFAULT_EVIDENCE_LENS, jsonFetch(body)))
            .rejects.toThrow('invalid response envelope (200)');
    });

    it('should describe a non-JSON upstream response', async () => {
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>proxy error</html>', {
            status: 502,
        }));
        await expect(requestEvidenceExport(target, DEFAULT_EVIDENCE_LENS, fetchImpl))
            .rejects.toThrow('invalid JSON (502)');
    });

    it('should preserve an API error message and provide a status fallback', async () => {
        await expect(requestEvidenceExport(target, DEFAULT_EVIDENCE_LENS,
            jsonFetch({ error: { message: 'Conversation unavailable' } }, 404)))
            .rejects.toThrow('Conversation unavailable');
        await expect(requestEvidenceExport(target, DEFAULT_EVIDENCE_LENS, jsonFetch({}, 503)))
            .rejects.toThrow('Focused evidence request failed (503)');
    });

    it.each([{}, { data: null }])('should reject a successful response without export data: %j', async (body) => {
        await expect(requestEvidenceExport(target, DEFAULT_EVIDENCE_LENS, jsonFetch(body)))
            .rejects.toThrow('did not include export data');
    });

    it('should propagate a fetch failure without returning invented export data', async () => {
        const failure = new Error('network unavailable');
        const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(failure);
        await expect(requestEvidenceExport(target, DEFAULT_EVIDENCE_LENS, fetchImpl)).rejects.toBe(failure);
    });
});
