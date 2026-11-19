/**
 * Cordis interfaces — re-declared locally to avoid peer dependency issues.
 * The actual shapes come from @deepseek-ai/cordis and dsh-agent at runtime.
 */
import { randomUUID } from "node:crypto";
import { handleCommand, parseCommand } from "./commands.js";
import { listWorkspaces, resolveWorkspace, getWorkspaceRegistry, findWorkspaceByPath } from "./workspaces.js";
import { loadChatState, saveChatState } from "./state.js";
/** Read the `title` value out of a projection block, if it is a usable string. */
function projectionTitle(block) {
    const value = block?.values?.title;
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
/**
 * Resolve a human title for one workspace session.
 *
 * Order: live in-memory projection cells (freshest, no fold) → durable
 * projection cache keyed by the session header (zero-I/O hint) → the plain
 * `title` field of a persistence entry, if it has one.
 */
function resolveSessionTitle(ctx, session) {
    try {
        const live = ctx.sessions?.get?.(session.sessionId);
        if (live) {
            const liveTitle = projectionTitle(ctx.sessionProjections?.cachedSnapshot?.(live, ["title"]));
            if (liveTitle)
                return liveTitle;
        }
    }
    catch {
        // optional service misbehaved — fall through to the durable cache
    }
    try {
        if (session.header) {
            const cachedTitle = projectionTitle(ctx.sessionProjectionCache?.cachedSnapshot?.(session.header, ["title"]));
            if (cachedTitle)
                return cachedTitle;
        }
    }
    catch {
        // ignored
    }
    return typeof session.title === "string" && session.title.trim().length > 0 ? session.title : undefined;
}
/** Resolve agentOptions from the global default model service. */
function resolveAgentOptions(ctx) {
    const dm = ctx.agentDefaultModel;
    if (!dm)
        return undefined;
    try {
        const sel = dm.currentSelection();
        return sel.provider || sel.model ? { provider: sel.provider, model: sel.model, reasoningEffort: sel.reasoningEffort } : undefined;
    }
    catch {
        return undefined;
    }
}
export function createRouter(bot, ctx) {
    // chatId → AgentHandle cache
    const chatToAgent = new Map();
    // chatId → sessionId (in-memory; lost on restart, recreated on next message)
    const chatToSession = new Map();
    // sessionId → text collected from assistant/message events of the running turn
    const inflightText = new Map();
    async function ensureAgent(chatId) {
        const cached = chatToAgent.get(chatId);
        if (cached)
            return cached;
        const sessionId = chatToSession.get(chatId);
        // Determine cwd: per-chat workspacePath > router-level cwd > process.cwd()
        const state = loadChatState(chatId);
        const agentCwd = state.workspacePath ?? ctx.cwd ?? process.cwd();
        ctx.logger.info(`ensureAgent: chatId=${chatId}, sessionId=${sessionId || 'none'}, agentCwd=${agentCwd}`);
        try {
            // Check if there's a live agent for this session (created by createNewSession but not cached)
            const live = sessionId ? ctx.agents.get?.(sessionId) : undefined;
            const handle = live
                ? { agent: live, dispose: async () => { } }
                : sessionId
                    ? await ctx.agents.resume({ resumeSessionId: sessionId })
                    : await ctx.agents.create({
                        sessionId: `telegram-${chatId}-${randomUUID()}`,
                        meta: { cwd: agentCwd },
                        agentOptions: resolveAgentOptions(ctx),
                    });
            if (!live) {
                chatToAgent.set(chatId, handle);
            }
            chatToSession.set(chatId, handle.agent.session.id);
            ctx.logger.info(`${sessionId ? "Resumed" : "Created"} session ${handle.agent.session.id} for chat ${chatId}`);
            return handle;
        }
        catch (err) {
            ctx.logger.error(`ensureAgent failed for chat ${chatId}: ${describe(err)}\n${err instanceof Error ? (err.stack || '') : ''}`);
            throw err;
        }
    }
    const router = {
        async routeMessage(chatId, message) {
            const text = message.text?.trim();
            if (!text)
                return;
            ctx.logger.info(`routeMessage called: chatId=${chatId}, text=${text.slice(0, 100)}`);
            // Commands are answered locally: they must not consume a turn of the agent.
            const parsed = parseCommand(text);
            if (parsed) {
                const result = await handleCommand(parsed.command, parsed.args, chatId, {
                    newSession,
                    listSessions,
                    listWorkspaces: () => listWorkspaces(ctx),
                    resolveWorkspace: (sel) => resolveWorkspace(ctx, sel),
                    saveWorkspacePath: (cid, path) => saveChatState(cid, { workspacePath: path }),
                    createNewSession,
                    stop: (cid) => router.stop(cid),
                    getStatus: (cid) => router.getStatus(cid),
                    listWorkspaceSessions: (cid) => router.listWorkspaceSessions(cid),
                });
                if (result.text)
                    await reply(chatId, result.text, result.reply_markup);
                return;
            }
            let handle;
            try {
                handle = await ensureAgent(chatId);
            }
            catch (err) {
                ctx.logger.error(`Failed to create/resume agent for chat ${chatId}: ${describe(err)}\n${err instanceof Error ? (err.stack || '') : ''}`);
                await reply(chatId, "⚠️ Failed to process your message. Please try again or use /new to start a fresh session.");
                return;
            }
            const sessionId = handle.agent.session.id;
            const collected = [];
            inflightText.set(sessionId, collected);
            try {
                handle.agent.followup({
                    id: randomUUID(),
                    role: "user",
                    content: [{ type: "text", text }],
                    source: { kind: "user" },
                });
                await handle.agent.whenIdle();
            }
            catch (err) {
                ctx.logger.error(`Agent submission failed for chat ${chatId}: ${describe(err)}\n${err instanceof Error ? (err.stack || '') : ''}`);
                await reply(chatId, "⚠️ An error occurred while processing your message. Please try again.");
                return;
            }
            finally {
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
        resolveWorkspace: (sel) => resolveWorkspace(ctx, sel),
        saveWorkspacePath: (chatId, path) => saveChatState(chatId, { workspacePath: path }),
        createNewSession,
        async stop(chatId) {
            const handle = chatToAgent.get(chatId);
            if (!handle)
                return false;
            if (handle.agent.status === "idle")
                return false;
            handle.agent.cancel({ kind: "user" });
            await handle.agent.whenIdle();
            // Clean up the stale agent from cache so next message creates a fresh one
            chatToAgent.delete(chatId);
            return true;
        },
        async getStatus(chatId) {
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
                    const reg = ctx.workspaceRegistry;
                    const wsEntry = reg?.list?.()?.find((ws) => ws.path === wsPath);
                    const wsTitle = wsEntry?.title || wsPath;
                    parts += `Воркспейс: ${wsTitle} (${wsPath})\n`;
                }
                if (status === "running") {
                    parts += `Статус: running`;
                }
                else {
                    parts += `Статус: idle`;
                }
                parts += "\n";
                // Session event count from persistence (if available)
                let eventCount = 0;
                try {
                    const stat = await fetchSessionStat(sessionId, ctx.sessionPersistence);
                    eventCount = stat?.eventCount ?? 0;
                }
                catch {
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
            }
            catch {
                // sessionPersistence may not be available
            }
            const wsPath = state.workspacePath;
            let parts = `📊 Сессия: ${shortId}\n`;
            if (wsPath) {
                const reg = ctx.workspaceRegistry;
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
        async listWorkspaceSessions(chatId) {
            const state = loadChatState(chatId);
            const workspacePath = state.workspacePath;
            if (!workspacePath) {
                return { text: "⚠️ Сначала выберите воркспейс командой /ws." };
            }
            const workspace = findWorkspaceByPath(ctx, workspacePath);
            if (!workspace) {
                return { text: `⚠️ Воркспейс "${workspacePath}" не найден в реестре. Выберите заново через /ws.` };
            }
            // "Живые" = прикреплённые к воркспейсу и не помеченные в архиве.
            const registry = getWorkspaceRegistry(ctx);
            const archived = new Set(Array.isArray(registry?.archivedSessionIds) ? registry.archivedSessionIds : []);
            const allIds = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [];
            const liveIds = allIds.filter((id) => typeof id === "string" && !archived.has(id));
            if (liveIds.length === 0) {
                const archivedCount = allIds.length - liveIds.length;
                return {
                    text: archivedCount > 0
                        ? `📂 В "${workspacePath}" нет живых сессий — все ${archivedCount} в архиве.`
                        : `📂 Живых сессий в "${workspacePath}" не найдено.`,
                };
            }
            // Метаданные (createdAt) — из сохранённых заголовков; если сервис недоступен,
            // список всё равно строится по id из реестра.
            let persisted = [];
            if (ctx.sessionPersistence) {
                try {
                    const listFn = ctx.sessionPersistence.list;
                    if (typeof listFn === "function")
                        persisted = await listFn();
                }
                catch (e) {
                    ctx.logger.warn(`sessionPersistence.list() failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
                }
            }
            const byId = new Map();
            for (const raw of persisted ?? []) {
                if (!raw || typeof raw !== "object")
                    continue;
                const header = raw.header;
                const sessionId = header?.id ?? raw.sessionId;
                if (typeof sessionId !== "string")
                    continue;
                byId.set(sessionId, {
                    ...(header ? { createdAt: header.createdAt, cwd: header.cwd } : {}),
                    ...raw,
                    sessionId,
                    header: header,
                });
            }
            // Runtime snapshots carry epoch-ms createdAt; be tolerant of ISO strings too.
            const timestampOf = (createdAt) => {
                if (typeof createdAt === "number" && Number.isFinite(createdAt))
                    return createdAt;
                const parsed = typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
                return Number.isFinite(parsed) ? parsed : 0;
            };
            const sessions = liveIds
                .map((id) => byId.get(id) ?? { sessionId: id })
                .sort((a, b) => timestampOf(b.createdAt) - timestampOf(a.createdAt));
            const currentSessionId = chatToSession.get(chatId) ?? state.sessionId;
            const LIMIT = 10;
            const shown = sessions.slice(0, LIMIT);
            const remaining = Math.max(0, sessions.length - LIMIT);
            const lines = shown.map((session) => {
                const marker = session.sessionId === currentSessionId ? "▶ " : "  ";
                const timestamp = timestampOf(session.createdAt);
                const timeStr = timestamp > 0 ? formatListTime(new Date(timestamp)) : "—";
                const title = resolveSessionTitle(ctx, session) ?? "Без названия";
                return `${marker}${timeStr} · ${title}`;
            });
            let text = `📂 Живые сессии в "${workspacePath}" (${sessions.length}):\n\n${lines.join("\n")}`;
            if (remaining > 0) {
                text += `\n…и ещё ${remaining}`;
            }
            return { text };
        },
        async handleCallback(chatId, data) {
            if (data === "act:stop") {
                const stopped = await this.stop(chatId);
                return stopped
                    ? { text: "⏹ Генерация остановлена." }
                    : { text: "⏹ Нечего останавливать." };
            }
            if (data === "act:new") {
                return await this.createNewSession(chatId);
            }
            return { text: "⚠️ Кнопка устарела." };
        },
        handleSessionEvent(sessionId, event) {
            const collected = inflightText.get(sessionId);
            if (!collected || event?.type !== "assistant/message")
                return;
            for (const block of event.data?.message?.content ?? []) {
                if (block?.type === "text" && typeof block.text === "string")
                    collected.push(block.text);
            }
        },
        async dispose() {
            const handles = [...chatToAgent.values()];
            chatToAgent.clear();
            chatToSession.clear();
            inflightText.clear();
            await Promise.all(handles.map((handle) => handle.dispose().catch((err) => {
                ctx.logger.error(`Failed to dispose agent: ${describe(err)}`);
            })));
        },
    };
    return router;
    function newSession(chatId) {
        const handle = chatToAgent.get(chatId);
        chatToAgent.delete(chatId);
        chatToSession.delete(chatId);
        if (handle) {
            void handle.dispose().catch((err) => {
                ctx.logger.error(`Failed to dispose agent for chat ${chatId}: ${describe(err)}`);
            });
        }
        ctx.logger.info(`New session requested for chat ${chatId}`);
    }
    async function createNewSession(chatId) {
        const state = loadChatState(chatId);
        const workspacePath = state.workspacePath;
        if (!workspacePath) {
            return {
                text: "⚠️ Сначала выберите воркспейс командой /ws. Без него бот не знает, в каком проекте работать.",
            };
        }
        // Find the workspace in the registry to get title and call attachSession
        const reg = ctx.workspaceRegistry;
        const wsEntry = reg?.list?.()?.find((ws) => ws.path === workspacePath);
        const sessionId = `telegram-${chatId}-${randomUUID()}`;
        try {
            // Clean up stale agent handle for this chat (if /new was called without /stop first)
            const stale = chatToAgent.get(chatId);
            if (stale) {
                chatToAgent.delete(chatId);
                await stale.dispose().catch((err) => {
                    ctx.logger.error(`Failed to dispose stale agent for chat ${chatId}: ${describe(err)}`);
                });
            }
            const handle = await ctx.agents.create({
                sessionId,
                meta: { cwd: workspacePath },
                agentOptions: resolveAgentOptions(ctx),
            });
            chatToAgent.set(chatId, handle);
            const actualSessionId = handle.agent.session.id;
            // Attach session to workspace for UI tree integration
            if (wsEntry && typeof wsEntry.attachSession === "function") {
                try {
                    wsEntry.attachSession(actualSessionId);
                }
                catch (attachErr) {
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
        }
        catch (err) {
            ctx.logger.error(`Failed to create agent for chat ${chatId}: ${describe(err)}`);
            return { text: `⚠️ Не удалось создать сессию: ${describe(err)}` };
        }
    }
    function listSessions() {
        return [...chatToSession].map(([chatId, sessionId]) => ({ chatId, sessionId }));
    }
    async function reply(chatId, text, replyMarkup) {
        try {
            await bot.sendText(chatId, text, replyMarkup ? { reply_markup: replyMarkup } : {});
        }
        catch (err) {
            ctx.logger.error(`Failed to send message to chat ${chatId}: ${describe(err)}`);
        }
    }
}
function describe(err) {
    return err instanceof Error ? err.message : String(err);
}
/** Fetch session stat from persistence, or undefined if unavailable. */
async function fetchSessionStat(sessionId, persistence) {
    if (!persistence || typeof persistence.stat !== "function")
        return undefined;
    try {
        return await persistence.stat(sessionId);
    }
    catch {
        return undefined;
    }
}
/** Format a Date as HH:MM (local time). */
function formatTime(date) {
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
}
/** Format one /list timestamp as `dd.MM HH:MM` (local time). */
function formatListTime(date) {
    const d = String(date.getDate()).padStart(2, "0");
    const mo = String(date.getMonth() + 1).padStart(2, "0");
    return `${d}.${mo} ${formatTime(date)}`;
}
/** Format a Duration in minutes and seconds. */
function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins > 0 && secs > 0)
        return `${mins}м ${secs}с`;
    if (mins > 0)
        return `${mins}м`;
    return `${secs}с`;
}
//# sourceMappingURL=router.js.map