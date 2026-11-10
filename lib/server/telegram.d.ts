import { IncomingMessage } from "node:http";
export type HttpRequestFn = (options: {
    hostname: string;
    port?: number;
    path: string;
    method: string;
    headers?: Record<string, string>;
}, callback?: (res: IncomingMessage) => void) => {
    on(event: string, handler: (...args: any[]) => void): void;
    setTimeout(ms: number): void;
    write(data: string): boolean;
    end(): void;
    destroy(): void;
};
export declare class TelegramBot {
    private token;
    private apiBase;
    private requestFn;
    constructor(token: string, options?: {
        apiBase?: string;
        requestFn?: HttpRequestFn;
    });
    private get baseUrl();
    /**
     * Make a request to the Telegram Bot API.
     * Implements retry logic:
     *   - 429 (Too Many Requests): wait and retry with exponential backoff
     *   - 500 (Server Error): retry up to 3 times with exponential backoff
     */
    request<T>(method: string, body?: Record<string, unknown>): Promise<T>;
    private doRequest;
    private sleep;
    getMe(): Promise<{
        id: number;
        is_bot: boolean;
        username: string;
        first_name: string;
        last_name?: string;
    }>;
    sendText(chatId: number | string, text: string, extra?: Record<string, unknown>): Promise<unknown>;
    sendPhoto(chatId: number | string, photo: string, caption?: string, extra?: Record<string, unknown>): Promise<unknown>;
    sendDocument(chatId: number | string, document: string, caption?: string, extra?: Record<string, unknown>): Promise<unknown>;
    setWebhook(url: string, secret?: string): Promise<unknown>;
    deleteWebhook(): Promise<unknown>;
    getFile(fileId: string): Promise<{
        file_path: string;
    }>;
}
//# sourceMappingURL=telegram.d.ts.map