export class AntigravityDecryptionCapabilityError extends Error {
    readonly code = 'ANTIGRAVITY_DECRYPTION_CAPABILITY';

    constructor(cause: unknown) {
        super('Antigravity decryption capability is unavailable', { cause });
        this.name = 'AntigravityDecryptionCapabilityError';
    }
}
