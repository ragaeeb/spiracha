import { describe, expect, it } from 'vitest';
import {
    decodeAnalyticsProjectSelectValue,
    encodeAnalyticsProjectSelectValue,
    parseAnalyticsSearch,
    parseTextQuerySearch,
    withAnalyticsProjectSearch,
    withTextQuerySearch,
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

    it('should encode analytics select values so the all-projects sentinel cannot collide with project names', () => {
        expect(encodeAnalyticsProjectSelectValue(null)).toBe('__all__');
        expect(encodeAnalyticsProjectSelectValue('__all__')).toBe('project:__all__');
        expect(decodeAnalyticsProjectSelectValue('__all__')).toBeNull();
        expect(decodeAnalyticsProjectSelectValue('spiracha')).toBeNull();
        expect(decodeAnalyticsProjectSelectValue('project:__all__')).toBe('__all__');
    });
});
