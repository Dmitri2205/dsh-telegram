import type { IncomingMessage, ServerResponse } from "node:http";
import { Agents } from "./router.js";
export declare const name = "telegram-bot";
export declare const inject: string[];
/** Settings page route. Registered unconditionally so the UI works before a token exists. */
export declare const SETTINGS_PATH = "/telegram/api/settings";
/**
 * Cordis interfaces — re-declared locally to avoid peer dependency issues.
 * The actual types come from @deepseek-ai/cordis at runtime.
 */
export interface WebServer {
    register(route: {
        kind: "exact" | "prefix";
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
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
    /** HTTP proxy for outbound Telegram calls; falls back to HTTPS_PROXY/HTTP_PROXY. */
    proxy?: string;
}
/** The subset of the config the settings page owns. */
export interface PersistedSettings {
    botToken?: string;
    allowedChatIds?: number[];
    /** Public URL Telegram must call. Empty means "derive from the server origin". */
    webhookUrl?: string;
}
/** Result of the last attempt to register the webhook with Telegram. */
export interface WebhookStatus {
    url: string;
    ok: boolean;
    error?: string;
    checkedAt: string;
}
/**
 * Turn any thrown value into a readable message. Errors raised by transport layers
 * sometimes carry an empty `message` and keep the real cause in `cause`/`code`.
 * @param err - the thrown value.
 * @returns a non-empty description.
 */
export declare function describeError(err: unknown): string;
/**
 * Read the settings page values: the persisted file wins, config is the fallback.
 * @param config - plugin config from cordis.patch.yml.
 * @returns the effective token and chat whitelist.
 */
export declare function loadSettings(config?: TelegramConfig): {
    botToken: string;
    allowedChatIds: number[];
    webhookUrl: string;
};
/**
 * Persist the settings page values.
 * @param settings - token and chat whitelist to store.
 */
export declare function saveSettings(settings: PersistedSettings): void;
/**
 * Apply the Telegram plugin.
 * Registers the settings API first, then the bot: router, webhook handler and
 * the webhook route. Returns a dispose function to clean up.
 */
export declare function apply(ctx: {
    webServer: WebServer;
    agents: Agents;
    credentials?: Credentials;
    on?: (event: "session/event", handler: (session: {
        id: string;
    }, event: unknown) => void) => () => void;
    logger?: {
        info(msg: string): void;
        error(msg: string): void;
        warn(msg: string): void;
        debug(msg: string): void;
    };
}, config?: TelegramConfig): () => void;
//# sourceMappingURL=index.d.ts.map