import type { ConversationSource } from '@spiracha/lib/conversation-data/types';
import {
    Bot,
    BrainCircuit,
    Code2,
    FolderOpen,
    type LucideIcon,
    Sparkles,
    SquareTerminal,
    Workflow,
} from 'lucide-react';

export const SOURCE_ICONS = {
    antigravity: Sparkles,
    'claude-code': Bot,
    cline: Bot,
    codex: FolderOpen,
    'command-code': Code2,
    cursor: SquareTerminal,
    fx: Workflow,
    grok: Bot,
    'grok-bot': Bot,
    kiro: BrainCircuit,
    'minimax-code': BrainCircuit,
    opencode: Code2,
    qoder: Workflow,
} satisfies Record<ConversationSource, LucideIcon>;
