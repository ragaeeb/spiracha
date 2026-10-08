import { describe, expect, it } from 'vitest';

const tableSources = import.meta.glob<string>('./*-table.tsx', { eager: true, import: 'default', query: '?raw' });
const listTables = Object.entries(tableSources).filter(([file]) =>
    /\/(?:[a-z-]+-)?(sessions|threads|tasks|conversations|chats)-table\.tsx$/u.test(file),
);

describe('conversation list tables', () => {
    it('should cover every per-source list table', () => {
        expect(listTables).toHaveLength(15);
    });

    it.each(listTables)('should render %s titles through the shared ConversationTitleCell', (_file, source) => {
        expect(source).toContain("from '#/components/conversation-title-cell'");
        expect(source).toContain('<ConversationTitleCell');
    });
});
