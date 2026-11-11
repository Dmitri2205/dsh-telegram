/**
 * Cordis interfaces — re-declared locally to avoid peer dependency issues.
 * The actual shapes come from @deepseek-ai/cordis and dsh-agent at runtime.
 */
import { randomUUID } from "node:crypto";
import { handleCommand, parseCommand } from "./commands.js";

/** Message the agent loop accepts through `agent.followup()`. */
export interface UserMessage {
  id: string;
  role: "user";
  content: Array<{ type: "text"; text: string }>;
  source: { kind: "user" };
}

export interface AgentHandle {
  agent: {
    id: string;
    session: { id: string };
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
  create(options: { sessionId: string; meta?: { cwd?: string } }): Promise<AgentHandle>;
  resume(options: { resumeSessionId: string }): Promise<AgentHandle>;
}

/** Shape of the `session/event` payload we care about. */
export interface SessionEventLike {
  type?: string;
  data?: { message?: { content?: Array<{ type?: string; text?: string }> } };
}

/**
 * ChatId → SessionId mapping router.
 * Maintains a cache of chatId → active agent handles.
 */
export interface Router {
  /** Route an incoming message to the appropriate agent session */
  routeMessage(
    chatId: number,
    message: { text?: string; photo?: string[]; document?: string },
  ): Promise<void>;

  /** Start a new session for a chatId */
  newSession(chatId: number): void;

  /** List all active session mappings */
  listSessions(): Array<{ chatId: number; sessionId: string }>;

  /** Feed a durable session event in; collects assistant text for the active turn */
  handleSessionEvent(sessionId: string, event: SessionEventLike): void;

  /** Dispose every agent this router created */
  dispose(): Promise<void>;
}

interface RouterContext {
  agents: Agents;
  logger: { info(msg: string): void; error(msg: string): void };
  /** Absolute working directory for newly created sessions. */
  cwd?: string;
}

export function createRouter(
  bot: {
    sendText: (chatId: number | string, text: string) => Promise<unknown>;
  },
  ctx: RouterContext,
): Router {
  // chatId → AgentHandle cache
  const chatToAgent = new Map<number, AgentHandle>();
  // chatId → sessionId (in-memory; lost on restart, recreated on next message)
  const chatToSession = new Map<number, string>();
  // sessionId → text collected from assistant/message events of the running turn
  const inflightText = new Map<string, string[]>();

  async function ensureAgent(chatId: number): Promise<AgentHandle> {
    const cached = chatToAgent.get(chatId);
    if (cached) return cached;

    const sessionId = chatToSession.get(chatId);
    const handle = sessionId
      ? await ctx.agents.resume({ resumeSessionId: sessionId })
      : await ctx.agents.create({
        sessionId: `telegram-${chatId}-${randomUUID()}`,
        meta: ctx.cwd === undefined ? undefined : { cwd: ctx.cwd },
      });

    chatToAgent.set(chatId, handle);
    chatToSession.set(chatId, handle.agent.session.id);
    ctx.logger.info(
      `${sessionId ? "Resumed" : "Created"} session ${handle.agent.session.id} for chat ${chatId}`,
    );
    return handle;
  }

  return {
    async routeMessage(chatId: number, message: { text?: string; photo?: string[]; document?: string }): Promise<void> {
      const text = message.text?.trim();
      if (!text) return;

      // Commands are answered locally: they must not consume a turn of the agent.
      const parsed = parseCommand(text);
      if (parsed) {
        const result = await handleCommand(parsed.command, parsed.args, chatId, { newSession, listSessions });
        if (result.text) await reply(chatId, result.text);
        return;
      }

      let handle: AgentHandle;
      try {
        handle = await ensureAgent(chatId);
      } catch (err) {
        ctx.logger.error(`Failed to create/resume agent for chat ${chatId}: ${describe(err)}`);
        await reply(chatId, "⚠️ Failed to process your message. Please try again or use /new to start a fresh session.");
        return;
      }

      const sessionId = handle.agent.session.id;
      const collected: string[] = [];
      inflightText.set(sessionId, collected);

      try {
        handle.agent.followup({
          id: randomUUID(),
          role: "user",
          content: [{ type: "text", text }],
          source: { kind: "user" },
        });
        await handle.agent.whenIdle();
      } catch (err) {
        ctx.logger.error(`Agent submission failed for chat ${chatId}: ${describe(err)}`);
        await reply(chatId, "⚠️ An error occurred while processing your message. Please try again.");
        return;
      } finally {
        inflightText.delete(sessionId);
      }

      const answer = collected.join("").trim();
      if (answer.length > 0) {
        await reply(chatId, answer);
      }
    },

    newSession,

    listSessions,

    handleSessionEvent(sessionId: string, event: SessionEventLike): void {
      const collected = inflightText.get(sessionId);
      if (!collected || event?.type !== "assistant/message") return;
      for (const block of event.data?.message?.content ?? []) {
        if (block?.type === "text" && typeof block.text === "string") collected.push(block.text);
      }
    },

    async dispose(): Promise<void> {
      const handles = [...chatToAgent.values()];
      chatToAgent.clear();
      chatToSession.clear();
      inflightText.clear();
      await Promise.all(handles.map((handle) =>
        handle.dispose().catch((err: unknown) => {
          ctx.logger.error(`Failed to dispose agent: ${describe(err)}`);
        })
      ));
    },
  };

  function newSession(chatId: number): void {
    const handle = chatToAgent.get(chatId);
    chatToAgent.delete(chatId);
    chatToSession.delete(chatId);
    if (handle) {
      void handle.dispose().catch((err: unknown) => {
        ctx.logger.error(`Failed to dispose agent for chat ${chatId}: ${describe(err)}`);
      });
    }
    ctx.logger.info(`New session requested for chat ${chatId}`);
  }

  function listSessions(): Array<{ chatId: number; sessionId: string }> {
    return [...chatToSession].map(([chatId, sessionId]) => ({ chatId, sessionId }));
  }

  async function reply(chatId: number, text: string): Promise<void> {
    try {
      await bot.sendText(chatId, text);
    } catch (err) {
      ctx.logger.error(`Failed to send message to chat ${chatId}: ${describe(err)}`);
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
