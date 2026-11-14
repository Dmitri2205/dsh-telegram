/** Inline keyboard button for Telegram reply_markup. */
export interface InlineKeyboardButton {
    text: string;
    callback_data: string;
}
/** Build a single-row inline keyboard from buttons. */
export declare function buildInlineKeyboard(buttons: Array<InlineKeyboardButton>): {
    inline_keyboard: Array<Array<InlineKeyboardButton>>;
};
/**
 * Parse a command string like "/start args" into { command, args }.
 * Returns null if the text doesn't start with a command.
 */
export declare function parseCommand(text: string): {
    command: string;
    args: string[];
} | null;
/**
 * Handle a parsed command and return the appropriate action.
 */
export declare function handleCommand(command: string, args: string[], chatId: number, router: {
    newSession(chatId: number): void;
    listSessions(): Array<{
        chatId: number;
        sessionId: string;
    }>;
    listWorkspaces(): Array<{
        index: number;
        id: string;
        path: string;
        title: string;
        sessionCount: number;
    }>;
    resolveWorkspace(selector: string): {
        path: string;
    };
    saveWorkspacePath(chatId: number, path: string): void;
    createNewSession(chatId: number): Promise<{
        text: string;
    }>;
    stop(chatId: number): Promise<boolean>;
    getStatus(chatId: number): Promise<{
        text: string;
    }>;
    listWorkspaceSessions(chatId: number): Promise<{
        text: string;
    }>;
}): Promise<{
    action: "send" | "new_session" | "list";
    text?: string;
    reply_markup?: unknown;
}>;
//# sourceMappingURL=commands.d.ts.map