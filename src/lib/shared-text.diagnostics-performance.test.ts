import { expect, it, spyOn } from 'bun:test';
import { resetParserDiagnosticForTests, warnParserDiagnosticOnce } from './shared-text';

it('should bound diagnostic scope retention while deduplicating recent warnings', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    const source = 'bounded-diagnostics-test';
    try {
        for (let index = 0; index < 2_049; index += 1) {
            warnParserDiagnosticOnce(source, 'invalid', {}, String(index));
        }
        warnParserDiagnosticOnce(source, 'invalid', {}, '2048');
        expect(warn).toHaveBeenCalledTimes(2_049);
        warnParserDiagnosticOnce(source, 'invalid', {}, '0');
        expect(warn).toHaveBeenCalledTimes(2_050);
    } finally {
        warn.mockRestore();
        for (let index = 0; index < 2_049; index += 1) {
            resetParserDiagnosticForTests(source, 'invalid', String(index));
        }
    }
});
