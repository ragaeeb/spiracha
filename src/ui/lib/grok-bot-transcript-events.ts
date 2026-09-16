import {
    canonicalMessagesToThreadEvents,
    type ThreadEvent,
    type ThreadTranscriptStats,
} from '@spiracha/lib/conversation-data/conversation-events';
import type { ConversationMessage } from '@spiracha/lib/conversation-data/types';
import { getThreadTranscriptStats } from './thread-transcript-stats';

const modelFrom = (message: ConversationMessage) => {
    const authorName = message.metadata.authorName;
    return typeof authorName === 'string' && authorName.trim() ? authorName : (message.model ?? null);
};

export const grokBotMessagesToThreadEvents = (messages: ConversationMessage[]): ThreadEvent[] =>
    canonicalMessagesToThreadEvents(messages, { modelFrom, source: 'grok_bot' });

export const getGrokBotThreadTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats =>
    getThreadTranscriptStats(events);
