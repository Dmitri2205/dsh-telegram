/**
 * Cordis interfaces — re-declared locally to avoid peer dependency issues.
 * The actual types come from @deepseek-ai/cordis at runtime.
 */
export interface AgentHandle {
    id: string;
    submit(input: {
        text?: string;
    }): Promise<{
        text?: string;
    }>;
}
export interface Agent {
    id: string;
    label?: string;
}
export interface Agents {
    create(options: {
        prompt?: string;
    }): Promise<AgentHandle>;
    resume(options: {
        sessionId: string;
    }): Promise<AgentHandle>;
    list(): Agent[];
    roots(): Agent[];
    register(agent: Agent): () => void;
}
/**
 * Note: session persistence is intentionally in-memory. The host storage hub
 * exposes only mounted data forms (`ctx.storage.form('domain')`), so a plain
 * `ctx.storage.form<string>()` throws `form-not-mounted` on the first message.
 */
/**
 * ChatId → SessionId mapping router.
 * Maintains a cache of chatId → active agent handles.
 */
export interface Router {
    /** Route an incoming message to the appropriate agent session */
    routeMessage(chatId: number, message: {
        text?: string;
        photo?: string[];
        document?: string;
    }): Promise<void>;
    /** Start a new session for a chatId */
    newSession(chatId: number): void;
    /** List all active session mappings */
    listSessions(): Array<{
        chatId: number;
        sessionId: string;
    }>;
}
interface RouterContext {
    agents: Agents;
    logger: {
        info(msg: string): void;
        error(msg: string): void;
    };
    attachments?: {
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
    };
}
export declare function createRouter(bot: {
    sendText: (chatId: number | string, text: string) => Promise<unknown>;
}, ctx: RouterContext): Router;
export {};
//# sourceMappingURL=router.d.ts.map