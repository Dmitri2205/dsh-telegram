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
export declare function handleCommand(command: string, args: string[], chatId: number, bot: {
    sendText: (chatId: number | string, text: string) => Promise<unknown>;
}, router: {
    newSession(chatId: number): void;
    listSessions(): Array<{
        chatId: number;
        sessionId: string;
    }>;
}): Promise<{
    action: "send" | "new_session" | "list";
    text?: string;
}>;
//# sourceMappingURL=commands.d.ts.map