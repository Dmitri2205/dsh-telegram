import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// ── Types ───────────────────────────────────────────────────────────────

export interface ChatState {
  chatId: number;
  workspacePath?: string;     // selected workspace (absolute path)
  sessionId?: string;         // active session in chat
  lastStatus?: 'idle' | 'running';
  updatedAt: string;          // ISO timestamp
}

// ── Storage layout ──────────────────────────────────────────────────────

let _chatsFile = join(homedir(), ".dsh", "telegram-chats.json");

/** Override the storage path. Used by tests. */
export function setChatsFile(path: string): void {
  _chatsFile = path;
}

/** Current storage path (for test verification). */
export function getChatsFilePath(): string {
  return _chatsFile;
}

function chatsDir(): string {
  return dirname(_chatsFile);
}

interface ChatStore {
  chats: Record<string, ChatState>;
}

function emptyStore(): ChatStore {
  return { chats: {} };
}

// ── Debounce helpers ────────────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPatch: { chatId: number; patch: Partial<ChatState> } | null = null;
const DEBOUNCE_MS = 500;

function flushSave(): void {
  if (!pendingPatch) return;
  const { chatId, patch } = pendingPatch;
  pendingPatch = null;

  try {
    const store = loadStoreSync();
    const key = String(chatId);
    const existing = store.chats[key];
    const now = new Date().toISOString();
    store.chats[key] = {
      chatId,
      workspacePath: patch.workspacePath ?? existing?.workspacePath,
      sessionId: patch.sessionId ?? existing?.sessionId,
      lastStatus: patch.lastStatus ?? existing?.lastStatus,
      updatedAt: patch.updatedAt ?? now,
    };
    writeStoreAtomically(store);
  } catch (err) {
    console.error("[dsh-telegram] saveChatState failed:", err);
  }
}

function scheduleSave(chatId: number, patch: Partial<ChatState>): void {
  pendingPatch = { chatId, patch };
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushSave();
  }, DEBOUNCE_MS);
}

// ── Low-level I/O ───────────────────────────────────────────────────────

function loadStoreSync(): ChatStore {
  if (!existsSync(_chatsFile)) {
    return emptyStore();
  }
  try {
    const raw = readFileSync(_chatsFile, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !parsed.chats) {
      return emptyStore();
    }
    return parsed as ChatStore;
  } catch {
    console.error("[dsh-telegram] Failed to load telegram-chats.json, returning default");
    return emptyStore();
  }
}

function ensureDir(): void {
  const dir = chatsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeStoreAtomically(store: ChatStore): void {
  ensureDir();
  const tmpFile = _chatsFile + ".tmp." + process.pid;
  try {
    writeFileSync(tmpFile, JSON.stringify(store, null, 2), "utf8");
    renameSync(tmpFile, _chatsFile);
  } catch (err) {
    // Clean up temp file on failure
    try { unlinkSync(tmpFile); } catch {}
    throw err;
  }
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Load chat state for a given chatId.
 * Returns default ChatState if not yet stored or file is missing/corrupt.
 */
export function loadChatState(chatId: number): ChatState {
  const key = String(chatId);
  const store = loadStoreSync();
  const existing = store.chats[key];

  if (existing) {
    return {
      chatId,
      workspacePath: typeof existing.workspacePath === "string" ? existing.workspacePath : undefined,
      sessionId: typeof existing.sessionId === "string" ? existing.sessionId : undefined,
      lastStatus: (existing.lastStatus === "idle" || existing.lastStatus === "running")
        ? existing.lastStatus
        : undefined,
      updatedAt: typeof existing.updatedAt === "string" ? existing.updatedAt : new Date().toISOString(),
    };
  }

  return { chatId, updatedAt: new Date().toISOString() };
}

/**
 * Persist a partial update for a chat.
 * Writes are debounced (batch) to once per 500 ms.
 */
export function saveChatState(chatId: number, patch: Partial<ChatState>): void {
  scheduleSave(chatId, patch);
}
