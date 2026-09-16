import type { ConversationMessageSelector } from './types';

export type NormalizedExportFormat = 'md' | 'txt';

export type NormalizedExportInclude = {
    artifacts: boolean;
    assistantFinal: boolean;
    bootstrap: boolean;
    commentary: boolean;
    metadata: boolean;
    reasoning: boolean;
    supplemental: boolean;
    synthetic: boolean;
    system: boolean;
    toolCalls: boolean;
    toolOutputs: boolean;
    unknown: boolean;
    user: boolean;
};

export type NormalizedExportOptions = {
    completeness: 'allow_partial' | 'require_available_full';
    format: NormalizedExportFormat;
    include: NormalizedExportInclude;
    messageSelector: ConversationMessageSelector;
    pathDisplay: {
        convertToProjectRoot: boolean;
        projectPath?: string | null;
        redactUsername: boolean;
    };
};

export type ExportPackaging = 'single' | 'zip';

export type BatchFailurePolicy = 'atomic' | 'partial';

export const FULL_AVAILABLE_EXPORT_INCLUDE = {
    artifacts: true,
    assistantFinal: true,
    bootstrap: false,
    commentary: true,
    metadata: true,
    reasoning: true,
    supplemental: true,
    synthetic: false,
    system: true,
    toolCalls: true,
    toolOutputs: true,
    unknown: true,
    user: true,
} as const satisfies NormalizedExportInclude;

export const CONVERSATION_ONLY_EXPORT_INCLUDE = {
    artifacts: true,
    assistantFinal: true,
    bootstrap: false,
    commentary: false,
    metadata: true,
    reasoning: false,
    supplemental: false,
    synthetic: false,
    system: false,
    toolCalls: false,
    toolOutputs: false,
    unknown: false,
    user: true,
} as const satisfies NormalizedExportInclude;

export const FULL_DIAGNOSTIC_EXPORT_INCLUDE = {
    ...FULL_AVAILABLE_EXPORT_INCLUDE,
    bootstrap: true,
    synthetic: true,
} as const satisfies NormalizedExportInclude;

export const DEFAULT_NORMALIZED_EXPORT_OPTIONS: NormalizedExportOptions = {
    completeness: 'require_available_full',
    format: 'md',
    include: FULL_AVAILABLE_EXPORT_INCLUDE,
    messageSelector: 'all',
    pathDisplay: {
        convertToProjectRoot: false,
        redactUsername: false,
    },
};

export type CompactExportFlags = {
    includeCommentary?: boolean;
    includeMetadata?: boolean;
    includeTools?: boolean;
    outputFormat?: NormalizedExportFormat;
};

export const expandNormalizedExportOptions = (
    options: Partial<NormalizedExportOptions> & CompactExportFlags = {},
): NormalizedExportOptions => {
    const include = {
        ...DEFAULT_NORMALIZED_EXPORT_OPTIONS.include,
        ...(options.include ?? {}),
    };
    if (options.includeCommentary !== undefined) {
        include.commentary = options.includeCommentary;
    }
    if (options.includeMetadata !== undefined) {
        include.metadata = options.includeMetadata;
    }
    if (options.includeTools !== undefined) {
        include.toolCalls = options.includeTools;
        include.toolOutputs = options.includeTools;
    }
    return {
        completeness: options.completeness ?? DEFAULT_NORMALIZED_EXPORT_OPTIONS.completeness,
        format: options.format ?? options.outputFormat ?? DEFAULT_NORMALIZED_EXPORT_OPTIONS.format,
        include,
        messageSelector: options.messageSelector ?? DEFAULT_NORMALIZED_EXPORT_OPTIONS.messageSelector,
        pathDisplay: {
            convertToProjectRoot:
                options.pathDisplay?.convertToProjectRoot ??
                DEFAULT_NORMALIZED_EXPORT_OPTIONS.pathDisplay.convertToProjectRoot,
            ...(options.pathDisplay?.projectPath === undefined ? {} : { projectPath: options.pathDisplay.projectPath }),
            redactUsername:
                options.pathDisplay?.redactUsername ?? DEFAULT_NORMALIZED_EXPORT_OPTIONS.pathDisplay.redactUsername,
        },
    };
};
