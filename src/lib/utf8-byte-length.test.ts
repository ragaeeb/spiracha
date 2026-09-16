import { expect, it } from 'bun:test';
import { utf8ByteLength } from './utf8-byte-length';

it('should match UTF-8 encoding for ASCII, Unicode, and broken surrogate sequences', () => {
    for (const value of [
        '',
        'ASCII\0\n',
        'ع中文🙂',
        '\ud800',
        '\udc00',
        '\ud800x\udc00',
        `${'x'.repeat(8_191)}🙂${'ع'.repeat(8_193)}`,
        '🙂'.repeat(100_000),
    ]) {
        expect(utf8ByteLength(value)).toBe(new TextEncoder().encode(value).byteLength);
    }
});

it('should match native encoding for deterministic mixed UTF-16 inputs', () => {
    let state = 42;
    for (let sample = 0; sample < 100; sample += 1) {
        const characters = Array.from({ length: 300 }, () => {
            state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
            return String.fromCharCode(state & 0xffff);
        });
        const value = characters.join('');
        expect(utf8ByteLength(value)).toBe(new TextEncoder().encode(value).byteLength);
    }
});
