import type { ToolCallSearchHit } from '@spiracha/lib/conversation-data/tool-call-search';
import { createContext, type ReactNode, useContext } from 'react';

type ToolCallHits = ReadonlyMap<string, ToolCallSearchHit> | null;

const ToolCallHitsContext = createContext<ToolCallHits>(null);

/** Lets any conversation row under a list show its tool call matches without threading props through tables. */
export const ToolCallHitsProvider = ({ children, hits }: { children: ReactNode; hits: ToolCallHits }) => (
    <ToolCallHitsContext.Provider value={hits}>{children}</ToolCallHitsContext.Provider>
);

export const useToolCallHit = (conversationId: string): ToolCallSearchHit | null =>
    useContext(ToolCallHitsContext)?.get(conversationId) ?? null;
