/**
 * Cordis interfaces — re-declared locally to avoid peer dependency issues.
 * The actual types come from @deepseek-ai/cordis at runtime.
 */
export interface AgentHandle {
  id: string;
  submit(input: { text?: string }): Promise<{ text?: string }>;
}

export interface Agent {
  id: string;
  label?: string;
}

export interface Agents {
  create(options: { prompt?: string }): Promise<AgentHandle>;
  resume(options: { sessionId: string }): Promise<AgentHandle>;
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
  routeMessage(
    chatId: number,
    message: { text?: string; photo?: string[]; document?: string },
  ): Promise<void>;

  /** Start a new session for a chatId */
  newSession(chatId: number): void;

  /** List all active session mappings */
  listSessions(): Array<{ chatId: number; sessionId: string }>;
}

interface RouterContext {
  agents: Agents;
  logger: { info(msg: string): void; error(msg: string): void };
  attachments?: {
    saveImages(inputs: Array<{ data: Uint8Array; mediaType: string; name?: string }>): Promise<
      Array<{ attachmentId: string; mediaType: string; bytes: number; width?: number; height?: number }>
    >;
    saveFile(input: { data: Uint8Array; name?: string }): Promise<{ attachmentId: string; name: string; bytes: number }>;
    saveFileStream(input: { data: import("node:stream").Readable; name?: string }): Promise<{ attachmentId: string; name: string; bytes: number }>;
  };
}

const STORAGE_KEY_PREFIX = "telegram:chat:";

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

  return {
    async routeMessage(chatId: number, message: { text?: string; photo?: string[]; document?: string }): Promise<void> {
      let agent = chatToAgent.get(chatId);

      // If no cached agent, create or resume one
      if (!agent) {
        const sessionId = chatToSession.get(chatId);

        try {
          if (sessionId) {
            // Resume existing session
            const handle = await ctx.agents.resume({ sessionId });
            agent = handle;
            chatToAgent.set(chatId, agent);
            ctx.logger.info(`Resumed session ${sessionId} for chat ${chatId}`);
          } else {
            // Create new session
            const handle = await ctx.agents.create({
              prompt: message.text || undefined,
            });
            agent = handle;
            chatToAgent.set(chatId, agent);

            // Remember the mapping so later messages resume this session
            chatToSession.set(chatId, handle.id);
            ctx.logger.info(`Created new session ${handle.id} for chat ${chatId}`);
          }
        } catch (err) {
          ctx.logger.error(`Failed to create/resume agent for chat ${chatId}: ${err instanceof Error ? err.message : String(err)}`);
          try {
            await bot.sendText(
              chatId,
              "⚠️ Failed to process your message. Please try again or use /new to start a fresh session.",
            );
          } catch (sendErr) {
            ctx.logger.error(`Failed to send error message: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
          }
          return;
        }
      }

      // Submit the message to the agent
      try {
        const response = await agent.submit({
          text: message.text,
        });

        if (response?.text) {
          await bot.sendText(chatId, response.text);
        }
      } catch (err) {
        ctx.logger.error(`Agent submission failed for chat ${chatId}: ${err instanceof Error ? err.message : String(err)}`);
        try {
          await bot.sendText(
            chatId,
            "⚠️ An error occurred while processing your message. Please try again.",
          );
        } catch (sendErr) {
          ctx.logger.error(`Failed to send error message: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
        }
      }
    },

    newSession(chatId: number): void {
      // Remove cached agent
      chatToAgent.delete(chatId);

      // Forget the mapping so the next message starts fresh
      chatToSession.delete(chatId);

      ctx.logger.info(`New session requested for chat ${chatId}`);
    },

    listSessions(): Array<{ chatId: number; sessionId: string }> {
      return [...chatToSession].map(([chatId, sessionId]) => ({ chatId, sessionId }));
    },
  };
}
