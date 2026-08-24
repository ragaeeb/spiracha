export const encodeVarint = (value: number): number[] => {
    const bytes: number[] = [];
    let remaining = value;
    while (remaining >= 0x80) {
        bytes.push((remaining & 0x7f) | 0x80);
        remaining = Math.floor(remaining / 0x80);
    }
    bytes.push(remaining);
    return bytes;
};

export const encodeString = (fieldNumber: number, value: string): number[] => {
    const bytes = [...Buffer.from(value, 'utf8')];
    return [...encodeVarint((fieldNumber << 3) | 2), ...encodeVarint(bytes.length), ...bytes];
};

export const encodeMessage = (fieldNumber: number, value: Iterable<number>): number[] => {
    const bytes = [...value];
    return [...encodeVarint((fieldNumber << 3) | 2), ...encodeVarint(bytes.length), ...bytes];
};
