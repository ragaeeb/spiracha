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
        expect(resolveSpirachaInvocation(['--help'])).toEqual({
            argv: [],
            kind: 'help',
        });
    });
});
