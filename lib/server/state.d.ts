export interface ChatState {
    chatId: number;
    workspacePath?: string;
    sessionId?: string;
    lastStatus?: 'idle' | 'running';
    updatedAt: string;
}
/** Override the storage path. Used by tests. */
export declare function setChatsFile(path: string): void;
/** Current storage path (for test verification). */
export declare function getChatsFilePath(): string;
/**
 * Load chat state for a given chatId.
 * Returns default ChatState if not yet stored or file is missing/corrupt.
 */
export declare function loadChatState(chatId: number): ChatState;
/**
 * Persist a partial update for a chat.
 * Writes are debounced (batch) to once per 500 ms.
 */
export declare function saveChatState(chatId: number, patch: Partial<ChatState>): void;
//# sourceMappingURL=state.d.ts.map