/** Message the agent loop accepts through `agent.followup()`. */
export interface UserMessage {
    id: string;
    role: "user";
    content: Array<{
        type: "text";
        text: string;
    }>;
    source: {
        kind: "user";
    };
}
export interface AgentHandle {
    agent: {
        id: string;
        session: {
            id: string;
        };
        followup(message: UserMessage): void;
        whenIdle(): Promise<void>;
        cancel(options?: {
            kind?: string;
        }): void;
        get status(): "idle" | "running";
    };
    dispose(): Promise<void>;
}
/**
 * `ctx.agents` from dsh-agent. Creation is identity-driven: the caller passes
 * the session id it wants, and the handle owns the agent until disposed.
 */
export interface AgentOptions {
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    maxTokens?: number;
}
export interface Agents {
    create(options: {
        sessionId: string;
        meta?: {
            cwd?: string;
        };
        agentOptions?: AgentOptions;
    }): Promise<AgentHandle>;
    resume(options: {
        resumeSessionId: string;
        agentOptions?: AgentOptions;
    }): Promise<AgentHandle>;
    get?(sessionId: string): AgentHandle["agent"] | undefined;
}
/** Shape of the `session/event` payload we care about. */
export interface SessionEventLike {
    type?: string;
    data?: {
        message?: {
            content?: Array<{
                type?: string;
                text?: string;
            }>;
        };
    };
}
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
    /** Feed a durable session event in; collects assistant text for the active turn */
    handleSessionEvent(sessionId: string, event: SessionEventLike): void;
    /** Dispose every agent this router created */
    dispose(): Promise<void>;
    /** List workspaces from the registry (for /ws command) */
    listWorkspaces(): Array<{
        index: number;
        id: string;
        path: string;
        title: string;
        sessionCount: number;
    }>;
    /** Resolve a workspace selector to { path } */
    resolveWorkspace(selector: string): {
        path: string;
    };
    /** Save workspace path for a chat (for /ws N command) */
    saveWorkspacePath(chatId: number, path: string): void;
    /** Create a new session in the chat's selected workspace. Returns reply text or error. */
    createNewSession(chatId: number): Promise<{
        text: string;
    }>;
    /** Stop the running agent for a chatId. Returns true if stopped, false otherwise. */
    stop(chatId: number): Promise<boolean>;
    /** Get status text for a chat's session (for /status command). */
    getStatus(chatId: number): Promise<{
        text: string;
    }>;
    /** List persisted sessions for the chat's selected workspace (for /list command). */
    listWorkspaceSessions(chatId: number): Promise<{
        text: string;
    }>;
    /** Handle an inline button callback from Telegram. */
    handleCallback(chatId: number, data: string): Promise<{
        text?: string;
    }>;
}
/** Minimal shape of a persisted session entry. */
interface PersistedSession {
    sessionId: string;
    title?: string;
    cwd: string;
    createdAt: string;
    eventCount?: number;
    /** Runtime persistence snapshot (may be absent in some profiles). */
    header?: {
        id?: string;
        cwd?: string;
        createdAt?: string;
    };
}
interface AgentDefaultModel {
    currentSelection(): {
        provider: string;
        model: string;
        reasoningEffort?: string;
    };
}
interface RouterContext {
    agents: Agents;
    logger: {
        info(msg: string): void;
        error(msg: string): void;
        warn(msg: string): void;
    };
    /** Absolute working directory for newly created sessions. */
    cwd?: string;
    /** Optional workspace registry (may be absent in profiles without workspaces). */
    workspaceRegistry?: unknown;
    /** Optional session persistence service (may be absent). */
    sessionPersistence?: {
        stat?(sessionId: string): Promise<{
            eventCount?: number;
        }> | {
            eventCount?: number;
        };
        list?(cwd?: string): Promise<PersistedSession[]> | PersistedSession[];
    };
    /** Optional agent default model service (may be absent). */
    agentDefaultModel?: AgentDefaultModel;
    /** Optional live session store (may be absent). */
    sessions?: {
        get?(sessionId: string): unknown;
        list?(): unknown[];
    };
    /** Optional live projection registry (may be absent). */
    sessionProjections?: {
        cachedSnapshot?(session: unknown, keys?: readonly string[]): {
            values?: Record<string, unknown>;
        } | undefined;
    };
    /** Optional durable projection cache for stored sessions (may be absent). */
    sessionProjectionCache?: {
        cachedSnapshot?(header: unknown, keys?: readonly string[]): {
            values?: Record<string, unknown>;
        } | undefined;
    };
    /** Alternative way to access services that may not be in inject. */
    get?(key: string): unknown;
}
export declare function createRouter(bot: {
    sendText: (chatId: number | string, text: string, extra?: Record<string, unknown>) => Promise<unknown>;
}, ctx: RouterContext): Router;
export {};
//# sourceMappingURL=router.d.ts.map