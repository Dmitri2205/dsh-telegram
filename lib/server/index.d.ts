import { Agents, Storage } from "./router.js";
export declare const inject: string[];
/**
 * Cordis interfaces — re-declared locally to avoid peer dependency issues.
 * The actual types come from @deepseek-ai/cordis at runtime.
 */
export interface WebServer {
    register(route: {
        kind: "exact" | "prefix";
        path: string;
        handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void | Promise<void>;
    }): () => void;
    getOrigin(): string;
}
export interface Attachments {
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
        data: import("node:stream").Readable;
        name?: string;
    }): Promise<{
        attachmentId: string;
        name: string;
        bytes: number;
    }>;
}
export interface ResolvedCredential {
    value: string | null;
}
export interface Credentials {
    resolve(ref: string): ResolvedCredential | undefined;
}
export interface TelegramConfig {
    botToken?: string;
    mode?: "webhook" | "polling";
    allowedChatIds?: number[];
    webhookSecret?: string;
    webhookPath?: string;
    maxFileSize?: number;
}
/**
 * Apply the Telegram plugin.
 * Sets up the bot, router, and webhook handler, then registers the webhook route.
 * Returns a dispose function to clean up.
 */
export declare function apply(ctx: {
    webServer: WebServer;
    agents: Agents;
    attachments: Attachments;
    credentials?: Credentials;
    storage: Storage;
    logger?: {
        info(msg: string): void;
        error(msg: string): void;
        warn(msg: string): void;
        debug(msg: string): void;
    };
}, config?: TelegramConfig): () => void;
//# sourceMappingURL=index.d.ts.map