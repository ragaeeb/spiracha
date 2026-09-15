import type { Capability, CapabilityBinding } from '../lib/conversation-data/capability';
import {
    DELETE_CAPABILITIES,
    NATIVE_FILE_RAW_CAPABILITY,
    REQUIRED_READ_CAPABILITIES,
} from '../lib/conversation-data/operation-types';
import type { SourceCatalog, SourceDescriptor } from '../lib/conversation-data/source-catalog';
import type { ConversationAdapter, ConversationAdapterRegistry } from '../lib/conversation-data/types';
import type { ConversationPayloadParserRegistry } from '../lib/conversation-payload-types';

const capabilities = { ...REQUIRED_READ_CAPABILITIES, ...NATIVE_FILE_RAW_CAPABILITY, ...DELETE_CAPABILITIES };

declare const missingRoute: Omit<SourceDescriptor<'codex'>, 'detailRouteSegment'>;
declare const missingCapabilities: Omit<SourceDescriptor<'codex'>, 'capabilities'>;
declare const missingCatalogSource: Omit<SourceCatalog, 'codex'>;
declare const missingAdapterSource: Omit<ConversationAdapterRegistry, 'codex'>;
declare const wrongSourceAdapter: ConversationAdapter<'grok'>;
declare const missingReadHandler: Omit<ConversationAdapter<'codex'>, 'getConversation'>;
declare const missingParserSource: Omit<ConversationPayloadParserRegistry, 'codex'>;

// @ts-expect-error Every descriptor must bind a detail route.
export const rejectsMissingRoute: SourceDescriptor<'codex'> = missingRoute;
// @ts-expect-error Every descriptor must declare operations.
export const rejectsMissingCapabilities: SourceDescriptor<'codex'> = missingCapabilities;
// @ts-expect-error A source ID requires an identity/route descriptor.
export const rejectsMissingCatalogSource: SourceCatalog = missingCatalogSource;
// @ts-expect-error An adapter registry cannot omit any source.
export const rejectsMissingAdapterSource: ConversationAdapterRegistry = missingAdapterSource;
// @ts-expect-error Registry keys and adapter IDs must agree.
export const rejectsMismatchedAdapter: ConversationAdapterRegistry['codex'] = wrongSourceAdapter;
// @ts-expect-error Required reads cannot silently become optional.
export const rejectsMissingReadHandler: ConversationAdapter<'codex'> = missingReadHandler;
// @ts-expect-error Payload-capable sources must supply a parser.
export const rejectsMissingParserSource: ConversationPayloadParserRegistry = missingParserSource;
// @ts-expect-error An exception requires a reason, not only a state.
export const rejectsUndeclaredException: Capability<'raw'> = { state: 'unsupported' };

type RawHandler = () => Promise<Blob>;
declare const handlerOnly: { handler: RawHandler };
type SupportedRaw = { state: 'supported'; value: 'raw' };
type UnsupportedRaw = { reason: 'Shared database has no standalone representation'; state: 'unsupported' };
type InapplicableRaw = { reason: 'Ephemeral input is not retained'; state: 'not_applicable' };

// @ts-expect-error Literal supported operations require their handler.
export const rejectsMissingCapabilityHandler: CapabilityBinding<SupportedRaw, RawHandler> = {};
// @ts-expect-error An unsupported declaration cannot have a callable handler.
export const rejectsUnsupportedHandler: CapabilityBinding<UnsupportedRaw, RawHandler> = handlerOnly;
// @ts-expect-error A not-applicable declaration cannot have a callable handler.
export const rejectsInapplicableHandler: CapabilityBinding<InapplicableRaw, RawHandler> = handlerOnly;

export const acceptsSupportedHandler: CapabilityBinding<SupportedRaw, RawHandler> = {
    handler: async () => new Blob(),
};
export const acceptsUnsupported: CapabilityBinding<UnsupportedRaw, RawHandler> = {};
export const acceptsInapplicable: CapabilityBinding<InapplicableRaw, RawHandler> = {};

export const acceptsWorkspaceRoute: SourceDescriptor<'codex'> = {
    capabilities,
    detailRouteSegment: 'threads',
    exportPlatform: 'codex',
    inventoryPath: '/codex',
    label: 'Codex',
    navigationOrder: 4,
    scope: 'workspace',
    source: 'codex',
    workspaceRoute: { parameterName: 'project', pathTemplate: '/codex/$project' },
};

// @ts-expect-error Workspace sources require a workspace route.
export const rejectsMissingWorkspaceRoute: SourceDescriptor<'codex'> = {
    capabilities,
    detailRouteSegment: 'threads',
    exportPlatform: 'codex',
    inventoryPath: '/codex',
    label: 'Codex',
    navigationOrder: 4,
    scope: 'workspace',
    source: 'codex',
};

export const rejectsGrokBotWorkspace: SourceDescriptor<'grok-bot'> = {
    capabilities,
    detailRouteSegment: 'grok-bot-chats',
    exportPlatform: 'grok-bot',
    inventoryPath: '/grok-bot',
    label: 'Grok Bot',
    navigationOrder: 8,
    scope: 'global',
    source: 'grok-bot',
    // @ts-expect-error Grok Bot cannot acquire a fake workspace route.
    workspaceRoute: { parameterName: 'workspaceKey', pathTemplate: '/grok-bot/$workspaceKey' },
};

type Catalog = typeof import('../lib/conversation-data/source-catalog').SOURCE_CATALOG;
type IndexedCodexRaw = Catalog['codex']['capabilities']['original_raw'];
type IndexedOpenCodeRaw = Catalog['opencode']['capabilities']['original_raw'];
type WidenedRaw = Capability<{ owner: 'source_reader' }>;
type CatalogRawHandler = () => Promise<null>;

type IndexedCodexDelete = Catalog['codex']['capabilities']['delete'];
type CatalogDeleteHandler = () => Promise<{ deletedFiles: string[]; deletedIds: string[] }>;

// @ts-expect-error Literal supported original_raw requires a handler.
export const rejectsMissingIndexedRawHandler: CapabilityBinding<IndexedCodexRaw, CatalogRawHandler> = {};
export const widenedCapabilityAllowsMissingHandler: CapabilityBinding<WidenedRaw, CatalogRawHandler> = {};
export const acceptsOpenCodeRawException: CapabilityBinding<IndexedOpenCodeRaw, CatalogRawHandler> = {};
export const rejectsOpenCodeRawHandler: CapabilityBinding<IndexedOpenCodeRaw, CatalogRawHandler> = {
    // @ts-expect-error Unsupported original_raw cannot bind a handler.
    handler: async () => null,
};
// @ts-expect-error Literal supported delete requires a handler.
export const rejectsMissingIndexedDeleteHandler: CapabilityBinding<IndexedCodexDelete, CatalogDeleteHandler> = {};
export const acceptsIndexedDeleteHandler: CapabilityBinding<IndexedCodexDelete, CatalogDeleteHandler> = {
    handler: async () => ({ deletedFiles: [], deletedIds: [] }),
};
