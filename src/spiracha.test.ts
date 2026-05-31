import { describe, expect, it } from 'bun:test';
import { getSpirachaHelpText, resolveSpirachaInvocation } from './spiracha';

describe('spiracha dispatcher', () => {
    it('should route the claude subcommand to the Claude CLI', () => {
        expect(resolveSpirachaInvocation(['claude', '/tmp/session.jsonl', '--tools'])).toEqual({
            argv: ['/tmp/session.jsonl', '--tools'],
            kind: 'claude',
        });
    });

    it('should route the codex subcommand to the Codex CLI', () => {
        expect(resolveSpirachaInvocation(['codex', '--project', 'summer'])).toEqual({
            argv: ['--project', 'summer'],
            kind: 'codex',
        });
    });

    it('should route the cursor subcommand to the Cursor CLI', () => {
        expect(resolveSpirachaInvocation(['cursor', 'export', '--workspace', 'demo'])).toEqual({
            argv: ['export', '--workspace', 'demo'],
            kind: 'cursor',
        });
    });

    it('should route the ui subcommand to the ui launcher', () => {
        expect(resolveSpirachaInvocation(['ui', '--port', '43123', '--no-open'])).toEqual({
            argv: ['--port', '43123', '--no-open'],
            kind: 'ui',
        });
    });

    it('should default to Codex when no subcommand is provided', () => {
        expect(resolveSpirachaInvocation(['--project', 'summer'])).toEqual({
            argv: ['--project', 'summer'],
            kind: 'codex',
        });
    });

    it('should show dispatcher help for top-level help requests', () => {
        const helpText = getSpirachaHelpText();
        expect(helpText).toContain('spiracha claude [Claude options]');
        expect(helpText).toContain('spiracha codex [Codex options]');
        expect(helpText).toContain('spiracha cursor [Cursor options]');
        expect(helpText).toContain('spiracha ui [UI options]');
        expect(resolveSpirachaInvocation(['--help'])).toEqual({
            argv: [],
            kind: 'help',
        });
    });
});
