import { describe, expect, it } from 'bun:test';
import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import {
    decryptAntigravitySafeStoragePayload,
    deriveAntigravitySafeStorageKey,
    getAntigravityDecryptionState,
} from './antigravity-keychain';

const encryptSafeStorageFixture = (value: string, keychainSecret: string): Buffer => {
    const key = pbkdf2Sync(keychainSecret, 'saltysalt', 1003, 16, 'sha1');
    const iv = Buffer.alloc(16, 0x20);
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([Buffer.from('v10'), cipher.update(value, 'utf8'), cipher.final()]);
};

describe('antigravity keychain helpers', () => {
    it('should derive the macOS safeStorage AES key from the Keychain secret', () => {
        const key = deriveAntigravitySafeStorageKey('fixture-secret');

        expect(key).toBeInstanceOf(Buffer);
        expect(key.byteLength).toBe(16);
        expect(key.toString('hex')).toBe(pbkdf2Sync('fixture-secret', 'saltysalt', 1003, 16, 'sha1').toString('hex'));
    });

    it('should decrypt Electron safeStorage JSON buffer payloads', () => {
        const encrypted = encryptSafeStorageFixture('decrypted transcript text', 'fixture-secret');
        const payload = JSON.stringify(encrypted);

        const decrypted = decryptAntigravitySafeStoragePayload(payload, 'fixture-secret');

        expect(decrypted).toBe('decrypted transcript text');
    });

    it('should report locked state without touching Keychain secrets', () => {
        const state = getAntigravityDecryptionState({ cachedSecret: null, platform: 'darwin' });

        expect(state).toMatchObject({
            canRequestAccess: true,
            isUnlocked: false,
            keychainAccount: 'Antigravity Key',
            keychainService: 'Antigravity Safe Storage',
            provider: 'keychain',
            status: 'locked',
        });
    });
});
