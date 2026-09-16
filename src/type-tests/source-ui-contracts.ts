import type { ConversationSource } from '../lib/conversation-data/types';
import { SOURCE_ICONS } from '../ui/lib/source-icons';

declare const missingIcon: Omit<typeof SOURCE_ICONS, 'codex'>;

// @ts-expect-error Every registered source requires a UI icon.
export const rejectsMissingIcon: typeof SOURCE_ICONS = missingIcon;

export const acceptsExhaustiveIcons: Record<ConversationSource, (typeof SOURCE_ICONS)[ConversationSource]> =
    SOURCE_ICONS;
