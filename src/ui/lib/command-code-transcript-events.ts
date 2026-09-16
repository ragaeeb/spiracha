import {
    canonicalMessagesToThreadEvents,
    type ThreadEvent,
    type ThreadTranscriptStats,
} from '@spiracha/lib/conversation-data/conversation-events';
import type { ConversationMessage } from '@spiracha/lib/conversation-data/types';
import { getThreadTranscriptStats } from './thread-transcript-stats';

export const commandCodeMessagesToThreadEvents = (messages: ConversationMessage[]): ThreadEvent[] =>
    canonicalMessagesToThreadEvents(messages, { source: 'command_code' });

export const getCommandCodeThreadTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats =>
    getThreadTranscriptStats(events);
