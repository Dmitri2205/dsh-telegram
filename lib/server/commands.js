/** Build a single-row inline keyboard from buttons. */
export function buildInlineKeyboard(buttons) {
    return { inline_keyboard: [buttons] };
}
/**
 * Parse a command string like "/start args" into { command, args }.
 * Returns null if the text doesn't start with a command.
 */
export function parseCommand(text) {
    if (!text || !text.startsWith("/"))
        return null;
    // Match /command or /command@botname
    const match = text.match(/^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+(.*))?$/);
    if (!match)
        return null;
    return {
        command: match[1].toLowerCase(),
        args: match[2] ? match[2].trim().split(/\s+/) : [],
    };
}
/**
 * Handle a parsed command and return the appropriate action.
 */
export async function handleCommand(command, args, chatId, router) {
    switch (command) {
        case "start": {
            router.newSession(chatId);
            return {
                action: "new_session",
                text: "👋 Welcome! I'm your DSH agent.\n\nI can help you with:\n• Conversations\n• File analysis\n• Image processing\n\nUse /help to see all commands.",
            };
        }
        case "new":
        case "newchat":
        case "reset": {
            router.newSession(chatId);
            const result = await router.createNewSession(chatId);
            return {
                action: "send",
                text: result.text,
            };
        }
        case "help": {
            return {
                action: "send",
                text: "📋 Available commands:\n\n" +
                    "/start — Start a new conversation\n" +
                    "/new — Start a fresh session\n" +
                    "/list — List active sessions\n" +
                    "/status — Show session status (agent state, session id, activity)\n" +
                    "/stop — Stop the running agent\n" +
                    "/help — Show this help message\n\n" +
                    "You can also send me text messages, photos, and documents!",
            };
        }
        case "list": {
            // Try persistence-based listing first (sessions from workspace)
            const result = await router.listWorkspaceSessions(chatId);
            if (result.text && !result.text.startsWith("⚠️")) {
                return { action: "send", text: result.text };
            }
            // Fallback to in-memory sessions if no workspace selected or persistence unavailable
            const sessions = router.listSessions();
            if (sessions.length === 0) {
                return {
                    action: "send",
                    text: "Нет активных сессий. Используйте /new для создания.",
                };
            }
            const lines = sessions.map((s, i) => `${i + 1}. Session: ${s.sessionId} (chat: ${s.chatId})`);
            return {
                action: "list",
                text: `📑 Active sessions (${sessions.length}):\n\n${lines.join("\n")}`,
            };
        }
        case "ws": {
            const workspaces = router.listWorkspaces();
            if (workspaces.length === 0) {
                return {
                    action: "send",
                    text: "Нет доступных воркспейсов",
                    reply_markup: buildInlineKeyboard([
                        { text: "🆕 New Chat", callback_data: "act:new" },
                    ]),
                };
            }
            // args[0] is the selector (number or path)
            const selector = args[0];
            if (selector === undefined || selector === "") {
                // No selector — show list
                const lines = workspaces.map((ws) => {
                    const marker = ws.title ? `*` : "";
                    return `${ws.index}. ${ws.title} — ${ws.path} (${ws.sessionCount} сессий)`;
                });
                return {
                    action: "send",
                    text: `📂 Воркспейсы (${workspaces.length}):\n\n${lines.join("\n")}`,
                    reply_markup: buildInlineKeyboard([
                        { text: "🆕 New Chat", callback_data: "act:new" },
                    ]),
                };
            }
            // Selector provided — resolve and save
            try {
                const resolved = router.resolveWorkspace(selector);
                router.saveWorkspacePath(chatId, resolved.path);
                return {
                    action: "send",
                    text: `✅ Воркспейс выбран: ${resolved.path}`,
                    reply_markup: buildInlineKeyboard([
                        { text: "⏹ Stop", callback_data: "act:stop" },
                        { text: "🆕 New", callback_data: "act:new" },
                    ]),
                };
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return {
                    action: "send",
                    text: msg,
                    reply_markup: buildInlineKeyboard([
                        { text: "⏹ Stop", callback_data: "act:stop" },
                        { text: "🆕 New", callback_data: "act:new" },
                    ]),
                };
            }
        }
        case "stop":
        case "cancel": {
            const stopped = await router.stop(chatId);
            if (!stopped) {
                return {
                    action: "send",
                    text: "⏹ Нечего останавливать — бот сейчас бездействует.",
                };
            }
            return {
                action: "send",
                text: "⏹ Генерация остановлена пользователем.",
            };
        }
        case "status": {
            const result = await router.getStatus(chatId);
            return {
                action: "send",
                text: result.text,
                reply_markup: buildInlineKeyboard([
                    { text: "⏹ Stop", callback_data: "act:stop" },
                    { text: "🆕 New", callback_data: "act:new" },
                ]),
            };
        }
        default: {
            return {
                action: "send",
                text: "❓ Unknown command. Use /help to see available commands.",
            };
        }
    }
}
//# sourceMappingURL=commands.js.map