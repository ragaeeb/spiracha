import { execFile } from 'node:child_process';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { promisify } from 'node:util';
import { AntigravityDecryptionCapabilityError } from './antigravity-decryption-error';

export const ANTIGRAVITY_KEYCHAIN_SERVICE = 'Antigravity Safe Storage';
export const ANTIGRAVITY_KEYCHAIN_ACCOUNT = 'Antigravity Key';

export type AntigravityDecryptionState = {
    canRequestAccess: boolean;
    error: string | null;
    isUnlocked: boolean;
    keychainAccount: string;
    keychainService: string;
    platform: NodeJS.Platform;
    provider: 'keychain' | 'unsupported';
    status: 'error' | 'locked' | 'unlocked' | 'unsupported';
};

export type AntigravityDecryptionCapability = Readonly<{
    decryptSafeStoragePayload: (payload: Buffer | Uint8Array | string) => string | null;
}>;

const execFileAsync = promisify(execFile);
const SAFE_STORAGE_SALT = 'saltysalt';
const SAFE_STORAGE_ITERATIONS = 1003;
const SAFE_STORAGE_KEY_LENGTH = 16;
const SAFE_STORAGE_IV = Buffer.alloc(16, 0x20);

let cachedKeychainSecret: string | null = null;
let lastKeychainError: string | null = null;

export const deriveAntigravitySafeStorageKey = (keychainSecret: string | Buffer): Buffer => {
    return pbkdf2Sync(keychainSecret, SAFE_STORAGE_SALT, SAFE_STORAGE_ITERATIONS, SAFE_STORAGE_KEY_LENGTH, 'sha1');
};

const parseBufferJson = (value: unknown): Buffer | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const data = (value as { data?: unknown }).data;
    if (!Array.isArray(data) || data.some((entry) => typeof entry !== 'number')) {
        return null;
    }

    return Buffer.from(data);
};

const normalizeEncryptedPayload = (payload: Buffer | Uint8Array | string): Buffer | null => {
    if (payload instanceof Buffer) {
        return payload;
    }

    if (payload instanceof Uint8Array) {
        return Buffer.from(payload);
    }

    const trimmed = payload.trim();
    if (trimmed.startsWith('{')) {
        try {
            return parseBufferJson(JSON.parse(trimmed));
        } catch {
            return null;
        }
    }

    return Buffer.from(payload, 'binary');
};

const hasSafeStoragePrefix = (payload: Buffer): boolean => {
    const prefix = payload.subarray(0, 3).toString('ascii');
    return prefix === 'v10' || prefix === 'v11';
};

const isReadableUtf8 = (value: string): boolean => {
    if (value.includes('\uFFFD')) {
        return false;
    }

    const printable = [...value].filter((char) => {
        const code = char.charCodeAt(0);
        return code === 9 || code === 10 || code === 13 || code >= 32;
    }).length;

    return value.length === 0 || printable / value.length > 0.95;
};

const decryptWithKey = (encrypted: Buffer, key: Buffer): string | null => {
    const ciphertext = hasSafeStoragePrefix(encrypted) ? encrypted.subarray(3) : encrypted;
    if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
        return null;
    }

    try {
        const decipher = createDecipheriv('aes-128-cbc', key, SAFE_STORAGE_IV);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        return isReadableUtf8(decrypted) ? decrypted : null;
    } catch {
        return null;
    }
};

export const decryptAntigravitySafeStoragePayload = (
    payload: Buffer | Uint8Array | string,
    keychainSecret: string,
): string | null => {
    const encrypted = normalizeEncryptedPayload(payload);
    if (!encrypted) {
        return null;
    }

    const keyAttempts = [deriveAntigravitySafeStorageKey(keychainSecret)];
    if (/^[A-Za-z0-9+/]+={0,2}$/u.test(keychainSecret)) {
        keyAttempts.push(deriveAntigravitySafeStorageKey(Buffer.from(keychainSecret, 'base64')));
    }

    for (const key of keyAttempts) {
        const decrypted = decryptWithKey(encrypted, key);
        if (decrypted !== null) {
            return decrypted;
        }
    }

    return null;
};

export const createAntigravityDecryptionCapability = (keychainSecret: string): AntigravityDecryptionCapability => ({
    decryptSafeStoragePayload: (payload) => decryptAntigravitySafeStoragePayload(payload, keychainSecret),
});

export const getAntigravityDecryptionState = ({
    cachedSecret = cachedKeychainSecret,
    error = null,
    hasAccess,
    lastError = lastKeychainError,
    platform = process.platform,
}: {
    cachedSecret?: string | null;
    error?: string | null;
    hasAccess?: boolean;
    lastError?: string | null;
    platform?: NodeJS.Platform;
} = {}): AntigravityDecryptionState => {
    if (platform !== 'darwin') {
        return {
            canRequestAccess: false,
            error: null,
            isUnlocked: false,
            keychainAccount: ANTIGRAVITY_KEYCHAIN_ACCOUNT,
            keychainService: ANTIGRAVITY_KEYCHAIN_SERVICE,
            platform,
            provider: 'unsupported',
            status: 'unsupported',
        };
    }

    const accessAvailable = hasAccess ?? Boolean(cachedSecret);
    const stateError = error ?? lastError;

    if (accessAvailable) {
        return {
            canRequestAccess: true,
            error: null,
            isUnlocked: true,
            keychainAccount: ANTIGRAVITY_KEYCHAIN_ACCOUNT,
            keychainService: ANTIGRAVITY_KEYCHAIN_SERVICE,
            platform,
            provider: 'keychain',
            status: 'unlocked',
        };
    }

    return {
        canRequestAccess: true,
        error: stateError,
        isUnlocked: false,
        keychainAccount: ANTIGRAVITY_KEYCHAIN_ACCOUNT,
        keychainService: ANTIGRAVITY_KEYCHAIN_SERVICE,
        platform,
        provider: 'keychain',
        status: stateError ? 'error' : 'locked',
    };
};

export const getAntigravityKeychainExecOptions = () => ({ timeout: 10_000 });

export const readAntigravityKeychainSecret = async (): Promise<string> => {
    if (process.platform !== 'darwin') {
        throw new Error('Antigravity Keychain access is only available on macOS.');
    }

    const { stdout } = await execFileAsync(
        'security',
        ['find-generic-password', '-s', ANTIGRAVITY_KEYCHAIN_SERVICE, '-a', ANTIGRAVITY_KEYCHAIN_ACCOUNT, '-w'],
        getAntigravityKeychainExecOptions(),
    );
    const secret = stdout.trim();
    if (!secret) {
        throw new Error(`No secret was returned for ${ANTIGRAVITY_KEYCHAIN_SERVICE}.`);
    }

    return secret;
};

const getAntigravityKeychainError = (error: unknown): string => {
    return error instanceof Error ? error.message : String(error);
};

export const withAntigravityDecryptionCapability = async <T>(
    action: (capability: AntigravityDecryptionCapability) => T | Promise<T>,
): Promise<T> => {
    if (!cachedKeychainSecret) {
        throw new AntigravityDecryptionCapabilityError(
            new Error('Antigravity Keychain access has not been enabled for this server process.'),
        );
    }

    return action(createAntigravityDecryptionCapability(cachedKeychainSecret));
};

export const probeAntigravityDecryptionState = async (): Promise<AntigravityDecryptionState> => {
    return getAntigravityDecryptionState();
};

export const unlockAntigravityDecryption = async (): Promise<AntigravityDecryptionState> => {
    try {
        cachedKeychainSecret = await readAntigravityKeychainSecret();
        lastKeychainError = null;
    } catch (error) {
        cachedKeychainSecret = null;
        lastKeychainError = getAntigravityKeychainError(error);
    }

    return getAntigravityDecryptionState();
};
