const UTF8_CHUNK_CHARACTERS = 8_192;
const encoder = new TextEncoder();
const scratch = new Uint8Array(UTF8_CHUNK_CHARACTERS * 3);

export const utf8ByteLength = (value: string): number => {
    if (/^[\u0000-\u007f]*$/u.test(value)) {
        return value.length;
    }
    let bytes = 0;
    let offset = 0;
    while (offset < value.length) {
        let end = Math.min(offset + UTF8_CHUNK_CHARACTERS, value.length);
        const last = value.charCodeAt(end - 1);
        const next = value.charCodeAt(end);
        // A surrogate pair must be encoded together, including at a chunk boundary.
        if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
            end -= 1;
        }
        bytes += encoder.encodeInto(value.slice(offset, end), scratch).written;
        offset = end;
    }
    return bytes;
};
