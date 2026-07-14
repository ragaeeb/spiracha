import { describe, expect, it } from 'bun:test';
import {
    decodeAntigravityGrpcWebJson,
    extractAntigravityCsrfToken,
    extractAntigravityProjectServiceUrl,
    resolveAntigravityProjectNames,
} from './antigravity-projects';

const encodeGrpcWebJson = (value: unknown): Uint8Array => {
    const payload = Buffer.from(JSON.stringify(value));
    const frame = new Uint8Array(payload.length + 5);
    new DataView(frame.buffer).setUint32(1, payload.length);
    frame.set(payload, 5);
    return frame;
};

describe('Antigravity project metadata', () => {
    it('should extract the CSRF token only from the Antigravity language server process', () => {
        const commands = [
            'other-process --csrf_token should-not-match',
            '/Applications/Antigravity.app/Contents/Resources/bin/language_server --app_data_dir antigravity --csrf_token 99de36ec-92f5-4d31-b44f-f4ef58ae38de',
        ].join('\n');

        expect(extractAntigravityCsrfToken(commands)).toBe('99de36ec-92f5-4d31-b44f-f4ef58ae38de');
    });

    it('should accept only a loopback Antigravity project service URL', () => {
        expect(
            extractAntigravityProjectServiceUrl([
                { type: 'page', url: 'https://127.0.0.1:60062/c/conversation-id?section=project-id' },
            ]),
        ).toBe('https://127.0.0.1:60062');
        expect(extractAntigravityProjectServiceUrl([{ type: 'page', url: 'https://example.com/c/id' }])).toBeNull();
    });

    it('should decode the first JSON data frame from a gRPC-Web response', () => {
        expect(
            decodeAntigravityGrpcWebJson(encodeGrpcWebJson({ project: { id: 'project-id', name: 'spiracha' } })),
        ).toEqual({
            project: { id: 'project-id', name: 'spiracha' },
        });
    });

    it('should resolve Antigravity project names from the authenticated loopback service', async () => {
        const requests: Array<{ body: Uint8Array; headers: Headers }> = [];
        const names = await resolveAntigravityProjectNames(['project-one', 'project-two'], {
            getConnection: async () => ({
                baseUrl: 'https://127.0.0.1:60062',
                csrfToken: 'csrf-token',
            }),
            request: async (_url, init) => {
                requests.push({
                    body: new Uint8Array(init.body as ArrayBuffer),
                    headers: new Headers(init.headers),
                });
                const request = decodeAntigravityGrpcWebJson(requests.at(-1)!.body) as { id: string };
                return new Response(
                    encodeGrpcWebJson({
                        project: {
                            id: request.id,
                            name: request.id === 'project-one' ? 'spiracha' : 'ushman-driver',
                        },
                    }).buffer as ArrayBuffer,
                    { status: 200 },
                );
            },
        });

        expect(names).toEqual(
            new Map([
                ['project-one', 'spiracha'],
                ['project-two', 'ushman-driver'],
            ]),
        );
        expect(requests).toHaveLength(2);
        expect(requests[0]?.headers.get('x-codeium-csrf-token')).toBe('csrf-token');
    });

    it('should fall back without throwing when Antigravity is not running', async () => {
        const names = await resolveAntigravityProjectNames(['project-one'], {
            getConnection: async () => null,
        });

        expect(names).toEqual(new Map());
    });
});
