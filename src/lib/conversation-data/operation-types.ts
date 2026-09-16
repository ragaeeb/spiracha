export type OperationId =
    | 'artifact_download'
    | 'batch_delete'
    | 'batch_normalized_export'
    | 'batch_original_raw'
    | 'delete'
    | 'deletion_reconciliation'
    | 'detail'
    | 'focused_evidence'
    | 'inventory'
    | 'list'
    | 'multi_selection'
    | 'normalized_export'
    | 'original_raw'
    | 'workspace_recovery'
    | 'workspace_removal';

export type OperationOwner = 'common_service' | 'source_mutator' | 'source_reader' | 'surface_store';

export type Supported<Value> = { state: 'supported'; value: Value };

export type ExceptionEvidence = {
    path: string;
    symbol: string;
    testId: string;
};

export type ReviewedException = {
    evidence: readonly [ExceptionEvidence, ...ExceptionEvidence[]];
    reason: string;
    reasonCode: string;
};

export type OperationCapability<Value = { owner: OperationOwner }> =
    | Supported<Value>
    | (ReviewedException & { state: 'unsupported' })
    | (ReviewedException & { state: 'not_applicable' });

export type SerializedSourceOperation =
    | { owner: OperationOwner; state: 'supported' }
    | { reason: string; reasonCode: string; state: 'not_applicable' | 'unsupported' };

const PLACEHOLDER_REASON = /^(?:later|not implemented|read-only adapter)$/iu;

export const isRejectedExceptionReason = (reason: string): boolean => {
    const normalized = reason.trim().toLowerCase();
    return normalized.length === 0 || PLACEHOLDER_REASON.test(normalized);
};

export const validateOperationCapability = (capability: OperationCapability): void => {
    if (capability.state === 'supported') {
        return;
    }
    if (isRejectedExceptionReason(capability.reason) || capability.reasonCode.trim().length === 0) {
        throw new Error('Exception declarations require a nonempty reviewed reason and reason code.');
    }
    if (capability.evidence.some((entry) => !entry.path.trim() || !entry.symbol.trim() || !entry.testId.trim())) {
        throw new Error('Exception evidence requires path, symbol, and testId.');
    }
};

export const serializeSourceOperation = (capability: OperationCapability): SerializedSourceOperation => {
    validateOperationCapability(capability);
    return capability.state === 'supported'
        ? { owner: capability.value.owner, state: 'supported' }
        : { reason: capability.reason, reasonCode: capability.reasonCode, state: capability.state };
};

export const serializeSourceOperations = <Caps extends Record<string, OperationCapability>>(
    capabilities: Caps,
): { [K in keyof Caps]: SerializedSourceOperation } => {
    return Object.fromEntries(
        Object.entries(capabilities).map(([id, capability]) => [id, serializeSourceOperation(capability)]),
    ) as { [K in keyof Caps]: SerializedSourceOperation };
};

export class UnsupportedSourceOperationError extends Error {
    readonly operation: OperationId;
    readonly reasonCode: string;
    readonly source: string;

    constructor(source: string, operation: OperationId, reason: string, reasonCode: string) {
        super(reason);
        this.name = 'UnsupportedSourceOperationError';
        this.operation = operation;
        this.reasonCode = reasonCode;
        this.source = source;
    }
}

export class OriginalRepresentationUnavailableError extends Error {
    readonly id: string;
    readonly source: string;

    constructor(source: string, id: string) {
        super('No original native file representation is available for this conversation.');
        this.name = 'OriginalRepresentationUnavailableError';
        this.id = id;
        this.source = source;
    }
}

export class SourceChangedError extends Error {
    readonly reasonCode = 'source_changed';

    constructor() {
        super('The original file changed during export. Retry the raw export.');
        this.name = 'SourceChangedError';
    }
}

export type PublicMutationError = {
    code: string;
    details?: Record<string, string>;
    message: string;
    operation: 'delete';
    retryable: boolean;
};

export class SourceMutationConflictError extends Error {
    readonly details: Record<string, string>;
    readonly id: string;
    readonly reasonCode: string;
    readonly source: string;

    constructor(source: string, id: string, reason: string, reasonCode: string, details: Record<string, string> = {}) {
        super(reason);
        this.name = 'SourceMutationConflictError';
        this.details = details;
        this.id = id;
        this.reasonCode = reasonCode;
        this.source = source;
    }
}

export type SourceReaderOwned = Supported<{ owner: 'source_reader' }>;
export type SourceMutatorOwned = Supported<{ owner: 'source_mutator' }>;

export const SOURCE_READER_OWNED = {
    state: 'supported',
    value: { owner: 'source_reader' },
} as const satisfies SourceReaderOwned;

export const REQUIRED_READ_CAPABILITIES = {
    detail: SOURCE_READER_OWNED,
    list: SOURCE_READER_OWNED,
} as const;

export type RequiredReadCapabilities = typeof REQUIRED_READ_CAPABILITIES;

export const NATIVE_FILE_RAW_CAPABILITY = {
    original_raw: SOURCE_READER_OWNED,
} as const;

export const SOURCE_MUTATOR_OWNED = {
    state: 'supported',
    value: { owner: 'source_mutator' },
} as const satisfies SourceMutatorOwned;

export const DELETE_CAPABILITIES = {
    batch_delete: SOURCE_MUTATOR_OWNED,
    delete: SOURCE_MUTATOR_OWNED,
} as const;

export const COMMON_SERVICE_OWNED = {
    state: 'supported',
    value: { owner: 'common_service' },
} as const satisfies Supported<{ owner: 'common_service' }>;

export const COMMON_EXPORT_CAPABILITIES = {
    batch_normalized_export: COMMON_SERVICE_OWNED,
    focused_evidence: COMMON_SERVICE_OWNED,
    inventory: COMMON_SERVICE_OWNED,
    multi_selection: COMMON_SERVICE_OWNED,
    normalized_export: COMMON_SERVICE_OWNED,
} as const;

export const DURABLE_DELETION_RECONCILIATION = {
    deletion_reconciliation: SOURCE_MUTATOR_OWNED,
} as const;

export class IncompleteTranscriptError extends Error {
    readonly reasonCode = 'incomplete_transcript';

    constructor(message: string) {
        super(message);
        this.name = 'IncompleteTranscriptError';
    }
}

export const OPENCODE_ORIGINAL_RAW_EXCEPTION = {
    original_raw: {
        evidence: [
            {
                path: 'src/lib/opencode-db.ts',
                symbol: 'readOpenCodeSessionTranscript',
                testId: 'should reject original raw for a multi-session OpenCode database',
            },
        ],
        reason: 'OpenCode stores conversations in shared relational tables with no standalone native conversation file.',
        reasonCode: 'no_native_conversation_file',
        state: 'unsupported',
    },
} as const satisfies { original_raw: OperationCapability };
