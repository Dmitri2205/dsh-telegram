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
    };
    dispose(): Promise<void>;
}
/**
 * `ctx.agents` from dsh-agent. Creation is identity-driven: the caller passes
 * the session id it wants, and the handle owns the agent until disposed.
 */
export interface Agents {
    create(options: {
        sessionId: string;
        meta?: {
            cwd?: string;
        };
    }): Promise<AgentHandle>;
    resume(options: {
        resumeSessionId: string;
    }): Promise<AgentHandle>;
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
}
interface RouterContext {
    agents: Agents;
    logger: {
        info(msg: string): void;
        error(msg: string): void;
    };
    /** Absolute working directory for newly created sessions. */
    cwd?: string;
}
export declare function createRouter(bot: {
    sendText: (chatId: number | string, text: string) => Promise<unknown>;
}, ctx: RouterContext): Router;
export {};
//# sourceMappingURL=router.d.ts.map