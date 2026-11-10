import { Readable } from "node:stream";
export interface HttpRequestFn {
    (url: string, options?: any): Promise<{
        statusCode: number;
        headers: Record<string, string | string[]>;
        body: Buffer;
    }>;
}
export interface MediaContext {
    attachments: {
        saveImages(inputs: Array<{
            data: Uint8Array;
            mediaType: string;
            name?: string;
        }>): Promise<Array<{
            attachmentId: string;
            mediaType: string;
            bytes: number;
            width?: number;
            height?: number;
        }>>;
        saveFile(input: {
            data: Uint8Array;
            name?: string;
        }): Promise<{
            attachmentId: string;
            name: string;
            bytes: number;
        }>;
        saveFileStream(input: {
            data: Readable;
            name?: string;
        }): Promise<{
            attachmentId: string;
            name: string;
            bytes: number;
        }>;
    };
    logger: {
        error(msg: string): void;
    };
}
/**
 * Download an image from a file URL and save it to DSH attachments.
 * Returns the raw Uint8Array.
 */
export declare function downloadAndSaveImage(fileUrl: string, ctx: MediaContext, maxSize?: number, httpGet?: HttpRequestFn): Promise<Uint8Array>;
/**
 * Download a file from a file URL and save it to DSH attachments.
 * Returns the raw Uint8Array.
 */
export declare function downloadAndSaveFile(fileUrl: string, ctx: MediaContext, maxSize?: number, httpGet?: HttpRequestFn): Promise<Uint8Array>;
//# sourceMappingURL=media.d.ts.map