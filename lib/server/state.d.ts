/**
 * ChatState stores per‑Telegram chat runtime information.
 */
export interface ChatState {
    chatId: number;
    workspacePath?: string;
    sessionId?: string;
    lastStatus?: 'idle' | 'running';
    updatedAt: string;
}
/**
 * Load chat state from disk synchronously.
 * Returns default object if file missing or corrupted.
 */
export declare function loadChatState(chatId: number): ChatState;
/**
 * Save patch to chat state atomically.
 * Batch writes are throttled to once per 500ms internally.
 */
export declare function saveChatState(patch: Partial<ChatState>): void;
//# sourceMappingURL=state.d.ts.map