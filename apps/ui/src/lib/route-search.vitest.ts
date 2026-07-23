import { describe, expect, it } from 'vitest';
import {
    decodeAnalyticsProjectSelectValue,
    encodeAnalyticsProjectSelectValue,
    getTranscriptDisplayState,
    parseAnalyticsSearch,
    parseMergedSearch,
    parseTextQuerySearch,
    parseThreadTranscriptSearch,
    withAnalyticsProjectSearch,
    withMergedSearch,
    withTextQuerySearch,
    withThreadTranscriptSearch,
} from './route-search';

describe('route search helpers', () => {
    it('should parse text query search params from the URL', () => {
        expect(parseTextQuerySearch({ q: 'spiracha' })).toEqual({ q: 'spiracha' });
        expect(parseTextQuerySearch({ q: '  spiracha  ' })).toEqual({ q: 'spiracha' });
        expect(parseTextQuerySearch({ q: '   ' })).toEqual({});
        expect(parseTextQuerySearch({ q: 42 })).toEqual({});
    });

    it('should keep text query search params bookmarkable while dropping empty values', () => {
        expect(withTextQuerySearch({ page: 'ignored' }, 'cursor')).toEqual({ page: 'ignored', q: 'cursor' });
        expect(withTextQuerySearch({ page: 'ignored' }, '  cursor  ')).toEqual({ page: 'ignored', q: 'cursor' });
        expect(withTextQuerySearch({ page: 'ignored', q: 'cursor' }, '')).toEqual({ page: 'ignored' });
    });

    it('should parse analytics project filters from the URL', () => {
        expect(parseAnalyticsSearch({ project: 'spiracha' })).toEqual({ project: 'spiracha' });
        expect(parseAnalyticsSearch({ project: '  spiracha  ' })).toEqual({ project: 'spiracha' });
        expect(parseAnalyticsSearch({ project: '' })).toEqual({});
        expect(parseAnalyticsSearch({ project: ['spiracha'] })).toEqual({});
    });

    it('should keep analytics project filters bookmarkable while dropping the all-projects value', () => {
        expect(withAnalyticsProjectSearch({ q: 'ignored' }, 'spiracha')).toEqual({
            project: 'spiracha',
            q: 'ignored',
        });
        expect(withAnalyticsProjectSearch({ q: 'ignored' }, '  spiracha  ')).toEqual({
            project: 'spiracha',
            q: 'ignored',
        });
        expect(withAnalyticsProjectSearch({ project: 'spiracha', q: 'ignored' }, null)).toEqual({ q: 'ignored' });
    });

    it('should keep merged conversation state bookmarkable', () => {
        expect(parseMergedSearch({ merged: 'true' })).toEqual({ merged: true });
        expect(parseMergedSearch({ merged: 'false' })).toEqual({});
        expect(withMergedSearch({ q: 'session' }, true)).toEqual({ merged: true, q: 'session' });
        expect(withMergedSearch({ merged: true, q: 'session' }, false)).toEqual({ q: 'session' });
    });

    it('should encode analytics select values so the all-projects sentinel cannot collide with project names', () => {
        expect(encodeAnalyticsProjectSelectValue(null)).toBe('__all__');
        expect(encodeAnalyticsProjectSelectValue('__all__')).toBe('project:__all__');
        expect(decodeAnalyticsProjectSelectValue('__all__')).toBeNull();
        expect(decodeAnalyticsProjectSelectValue('spiracha')).toBeNull();
        expect(decodeAnalyticsProjectSelectValue('project:__all__')).toBe('__all__');
    });

    it('should parse thread transcript filters from the URL', () => {
        expect(
            parseThreadTranscriptSearch({
                commentary: 'true',
                extra: '1',
                full: 'true',
                merged: 'true',
                q: '  export  ',
                raw: 'false',
                sort: 'latest',
                tools: true,
                user: '0',
            }),
        ).toEqual({
            commentary: true,
            extra: true,
            full: true,
            merged: true,
            q: 'export',
            sort: 'latest',
            tools: true,
        });
        expect(parseThreadTranscriptSearch({ sort: 'earliest' })).toEqual({});
        expect(parseThreadTranscriptSearch({ sort: 'other' })).toEqual({});
    });

    it('should keep thread transcript filters bookmarkable while dropping false values', () => {
        expect(
            withThreadTranscriptSearch(
                {
                    commentary: true,
                    q: 'export',
                    tools: true,
                },
                {
                    extra: true,
                    full: true,
                    merged: true,
                    q: '',
                    sort: 'latest',
                    tools: false,
                    user: true,
                },
            ),
        ).toEqual({
            commentary: true,
            extra: true,
            full: true,
            merged: true,
            sort: 'latest',
            user: true,
        });
        expect(withThreadTranscriptSearch({ sort: 'latest' }, { sort: 'earliest' })).toEqual({});
    });

    it('should preserve unrelated route search while updating transcript display toggles', () => {
        expect(withThreadTranscriptSearch({ panel: 'raw', tools: true }, { commentary: true, tools: false })).toEqual({
            commentary: true,
            panel: 'raw',
        });
    });

    it('should derive transcript display state with false defaults', () => {
        expect(getTranscriptDisplayState({ commentary: true, raw: true })).toEqual({
            showCommentary: true,
            showExtraEvents: false,
            showRawJson: true,
            showToolCalls: false,
            showUserMessages: false,
        });
    });
});
