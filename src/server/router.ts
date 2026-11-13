/**
 * Cordis interfaces — re-declared locally to avoid peer dependency issues.
 * The actual shapes come from @deepseek-ai/cordis and dsh-agent at runtime.
 */
import { randomUUID } from "node:crypto";
import { handleCommand, parseCommand } from "./commands.js";
import { listWorkspaces, resolveWorkspace, getWorkspaceRegistry } from "./workspaces.js";
import { loadChatState, saveChatState } from "./state.js";

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
    cancel(options?: { kind?: string }): void;
    get status(): "idle" | "running";
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

  /** List workspaces from the registry (for /ws command) */
  listWorkspaces(): Array<{ index: number; id: string; path: string; title: string; sessionCount: number }>;

  /** Resolve a workspace selector to { path } */
  resolveWorkspace(selector: string): { path: string };

  /** Save workspace path for a chat (for /ws N command) */
  saveWorkspacePath(chatId: number, path: string): void;

  /** Create a new session in the chat's selected workspace. Returns reply text or error. */
  createNewSession(chatId: number): Promise<{ text: string }>;

  /** Stop the running agent for a chatId. Returns true if stopped, false otherwise. */
  stop(chatId: number): Promise<boolean>;

  /** Get status text for a chat's session (for /status command). */
  getStatus(chatId: number): Promise<{ text: string }>;

  /** List persisted sessions for the chat's selected workspace (for /list command). */
  listWorkspaceSessions(chatId: number): Promise<{ text: string }>;
}

interface RouterContext {
  agents: Agents;
  logger: { info(msg: string): void; error(msg: string): void };
  /** Absolute working directory for newly created sessions. */
  cwd?: string;
  /** Optional workspace registry (may be absent in profiles without workspaces). */
  workspaceRegistry?: unknown;
  /** Minimal shape of a persisted session entry. */
  export interface PersistedSession {
    sessionId: string;
    title?: string;
    cwd: string;
    createdAt: string;            // ISO timestamp
    eventCount?: number;
  }

  /** Optional session persistence service (may be absent). */
  sessionPersistence?: {
    stat?(sessionId: string): Promise<{ eventCount?: number }> | { eventCount?: number };
    list?(cwd?: string): Promise<PersistedSession[]> | PersistedSession[];
  };
  /** Alternative way to access services that may not be in inject. */
  get?(key: string): unknown;
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
    // Determine cwd: per-chat workspacePath > router-level cwd > process.cwd()
    const state = loadChatState(chatId);
    const agentCwd = state.workspacePath ?? ctx.cwd ?? process.cwd();

    const handle = sessionId
      ? await ctx.agents.resume({ resumeSessionId: sessionId })
      : await ctx.agents.create({
          sessionId: `telegram-${chatId}-${randomUUID()}`,
          meta: { cwd: agentCwd },
        });

    chatToAgent.set(chatId, handle);
    chatToSession.set(chatId, handle.agent.session.id);
    ctx.logger.info(
      `${sessionId ? "Resumed" : "Created"} session ${handle.agent.session.id} for chat ${chatId}`,
    );
    return handle;
  }

  const router = {
    async routeMessage(chatId: number, message: { text?: string; photo?: string[]; document?: string }): Promise<void> {
      const text = message.text?.trim();
      if (!text) return;

      // Commands are answered locally: they must not consume a turn of the agent.
      const parsed = parseCommand(text);
      if (parsed) {
        const result = await handleCommand(parsed.command, parsed.args, chatId, {
          newSession,
          listSessions,
          listWorkspaces: () => listWorkspaces(ctx),
          resolveWorkspace: (sel: string) => resolveWorkspace(ctx, sel),
          saveWorkspacePath: (cid: number, path: string) => saveChatState(cid, { workspacePath: path }),
          createNewSession,
          stop: (cid: number) => router.stop(cid),
          getStatus: (cid: number) => router.getStatus(cid),
          listWorkspaceSessions: (cid: number) => router.listWorkspaceSessions(cid),
        });
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

    listWorkspaces: () => listWorkspaces(ctx),

    resolveWorkspace: (sel: string) => resolveWorkspace(ctx, sel),

    saveWorkspacePath: (chatId: number, path: string) => saveChatState(chatId, { workspacePath: path }),

    createNewSession,

    async stop(chatId: number): Promise<boolean> {
      const handle = chatToAgent.get(chatId);
      if (!handle) return false;
      if (handle.agent.status === "idle") return false;
      handle.agent.cancel({ kind: "user" });
      await handle.agent.whenIdle();
      // Clean up the stale agent from cache so next message creates a fresh one
      chatToAgent.delete(chatId);
      return true;
    },

    async getStatus(chatId: number): Promise<{ text: string }> {
      const state = loadChatState(chatId);
      // Prefer in-memory sessionId (set on first message) over persisted one
      const sessionId = chatToSession.get(chatId) ?? state.sessionId;

      if (!sessionId) {
        return {
          text: "⚠️ Нет активной сессии. Создайте новую командой /new.",
        };
      }

      // Try to find a live agent handle
      const handle = chatToAgent.get(chatId);
      const shortId = sessionId.slice(0, 8);

      if (handle) {
        // Live agent: get status + elapsed time since turn started
        const now = new Date();
        const status = handle.agent.status;
        let parts = `📊 Сессия: ${shortId}\n`;

        // Workspace info from state
        const wsPath = state.workspacePath;
        if (wsPath) {
          const reg = ctx.workspaceRegistry as { list?: () => Array<{ id: string; path: string; title?: string }> } | undefined;
          const wsEntry = reg?.list?.()?.find((ws) => ws.path === wsPath);
          const wsTitle = wsEntry?.title || wsPath;
          parts += `Воркспейс: ${wsTitle} (${wsPath})\n`;
        }

        if (status === "running") {
          parts += `Статус: running`;
        } else {
          parts += `Статус: idle`;
        }
        parts += "\n";

        // Session event count from persistence (if available)
        let eventCount = 0;
        try {
          const stat = await fetchSessionStat(sessionId, ctx.sessionPersistence);
          eventCount = stat?.eventCount ?? 0;
        } catch {
          // sessionPersistence may not be available
        }

        parts += `Событий: ${eventCount}`;
        if (handle && state.lastStatus) {
          parts += ` | последняя активность: ${formatTime(new Date(state.updatedAt))}`;
        }

        return { text: parts };
      }

      // No live agent — fall back to persistence stat
      let eventCount = 0;
      try {
        const stat = await fetchSessionStat(sessionId, ctx.sessionPersistence);
        eventCount = stat?.eventCount ?? 0;
      } catch {
        // sessionPersistence may not be available
      }

      const wsPath = state.workspacePath;
      let parts = `📊 Сессия: ${shortId}\n`;
      if (wsPath) {
        const reg = ctx.workspaceRegistry as { list?: () => Array<{ id: string; path: string; title?: string }> } | undefined;
        const wsEntry = reg?.list?.()?.find((ws) => ws.path === wsPath);
        const wsTitle = wsEntry?.title || wsPath;
        parts += `Воркспейс: ${wsTitle} (${wsPath})\n`;
      }

      parts += `Статус: idle\n`;
      parts += `Событий: ${eventCount}`;
      if (state.lastStatus) {
        parts += ` | последняя активность: ${formatTime(new Date(state.updatedAt))}`;
      }

      return { text: parts };
    },

    async listWorkspaceSessions(chatId: number): Promise<{ text: string }> {
      const state = loadChatState(chatId);
      const workspacePath = state.workspacePath;
      if (!workspacePath) {
        return { text: "⚠️ Сначала выберите воркспейс командой /ws." };
      }

      // Get persisted sessions filtered by workspace cwd
      let persisted: PersistedSession[] = [];
      try {
        const listFn = ctx.sessionPersistence?.list;
        if (typeof listFn === "function") {
          persisted = await listFn(workspacePath);
        }
      } catch {
        // persistence may not be available — fall back to in-memory
      }

      // Filter by cwd, sort newest first
      const filtered = persisted
        .filter((s) => s.cwd === workspacePath)
        .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));

      const currentSessionId = chatToSession.get(chatId) ?? state.sessionId;
      const LIMIT = 10;
      const shown = filtered.slice(0, LIMIT);
      const remaining = Math.max(0, filtered.length - LIMIT);

      if (shown.length === 0) {
        return { text: `📂 Сессий в "${workspacePath}" не найдено.` };
      }

      const lines = shown.map((s) => {
        const marker = s.sessionId === currentSessionId ? "▶ " : "  ";
        const shortId = s.sessionId.slice(0, 8);
        const created = new Date(s.createdAt);
        const timeStr = formatTime(created);
        const eventInfo = s.eventCount != null ? ` (${s.eventCount} events)` : "";
        return `${marker}${shortId}  ${timeStr}${eventInfo}`;
      });

      let text = `📂 Сессии в "${workspacePath}" (${filtered.length}):\n\n${lines.join("\n")}`;
      if (remaining > 0) {
        text += `\n…и ещё ${remaining}`;
      }

      return { text };
    },

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

  return router;

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

  async function createNewSession(chatId: number): Promise<{ text: string }> {
    const state = loadChatState(chatId);
    const workspacePath = state.workspacePath;

    if (!workspacePath) {
      return {
        text: "⚠️ Сначала выберите воркспейс командой /ws. Без него бот не знает, в каком проекте работать.",
      };
    }

    // Find the workspace in the registry to get title and call attachSession
    const reg = ctx.workspaceRegistry as { list?: () => Array<{ id: string; path: string; title?: string; sessionIds: string[]; attachSession?: (sid: string) => void }> } | undefined;
    const wsEntry = reg?.list?.()?.find((ws) => ws.path === workspacePath);

    const sessionId = `telegram-${chatId}-${randomUUID()}`;

    try {
      const handle = await ctx.agents.create({
        sessionId,
        meta: { cwd: workspacePath },
      });

      const actualSessionId = handle.agent.session.id;

      // Attach session to workspace for UI tree integration
      if (wsEntry && typeof wsEntry.attachSession === "function") {
        try {
          wsEntry.attachSession(actualSessionId);
        } catch (attachErr) {
          ctx.logger.error(`attachSession failed for chat ${chatId}: ${describe(attachErr)}`);
        }
      }

      // Update in-memory caches
      chatToSession.set(chatId, actualSessionId);

      // Persist sessionId to disk
      saveChatState(chatId, { sessionId: actualSessionId });

      const title = wsEntry?.title || workspacePath;
      const shortId = actualSessionId.slice(0, 8);
      ctx.logger.info(`Created session ${actualSessionId} for chat ${chatId} in ${workspacePath}`);

      return { text: `🆕 Сессия ${shortId} в ${title} (${workspacePath})` };
    } catch (err) {
      ctx.logger.error(`Failed to create agent for chat ${chatId}: ${describe(err)}`);
      return { text: `⚠️ Не удалось создать сессию: ${describe(err)}` };
    }
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

/** Fetch session stat from persistence, or undefined if unavailable. */
async function fetchSessionStat(
  sessionId: string,
  persistence?: { stat?(sessionId: string): Promise<{ eventCount?: number }> | { eventCount?: number } },
): Promise<{ eventCount?: number } | undefined> {
  if (!persistence || typeof persistence.stat !== "function") return undefined;
  try {
    return await persistence.stat(sessionId);
  } catch {
    return undefined;
  }
}

/** Format a Date as HH:MM (local time). */
function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** Format a Duration in minutes and seconds. */
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins > 0 && secs > 0) return `${mins}м ${secs}с`;
  if (mins > 0) return `${mins}м`;
  return `${secs}с`;
}
