export type RawInlineDownload = {
    contentBase64: string;
    fileName: string;
    mimeType: string;
    mode: 'download_base64';
};

export const decodeRawDownloadBase64 = (contentBase64: string): Uint8Array<ArrayBuffer> => {
    const binary = atob(contentBase64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};
