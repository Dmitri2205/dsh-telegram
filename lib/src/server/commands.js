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
export async function handleCommand(command, args, chatId, bot, router) {
    switch (command) {
        case "start":
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
            return {
                action: "new_session",
                text: "🔄 New session started. How can I help you?",
            };
        }
        case "help": {
            return {
                action: "send",
                text: "📋 Available commands:\n\n" +
                    "/start — Start a new conversation\n" +
                    "/new — Start a fresh session\n" +
                    "/list — List active sessions\n" +
                    "/help — Show this help message\n\n" +
                    "You can also send me text messages, photos, and documents!",
            };
        }
        case "list": {
            const sessions = router.listSessions();
            if (sessions.length === 0) {
                return {
                    action: "send",
                    text: "No active sessions. Use /start to begin a conversation.",
                };
            }
            const lines = sessions.map((s, i) => `${i + 1}. Session: ${s.sessionId.slice(0, 8)}... (chat: ${s.chatId})`);
            return {
                action: "list",
                text: `📑 Active sessions (${sessions.length}):\n\n${lines.join("\n")}`,
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