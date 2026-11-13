import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadChatState, saveChatState, setChatsFile, getChatsFilePath } from "../src/server/state.js";
import { existsSync, writeFileSync, unlinkSync, mkdirSync, readFileSync, readdirSync, rmdirSync } from "node:fs";
import { join, dirname } from "node:path";

// ── Helpers ─────────────────────────────────────────────────────────────

const TEST_DIR = "/tmp/dsh-telegram-test-" + process.pid;

function ensureTestDir(): void {
  mkdirSync(TEST_DIR, { recursive: true });
}

function setTestFile(name: string): void {
  ensureTestDir();
  setChatsFile(join(TEST_DIR, name));
}

function writeChatsFile(content: string): void {
  const file = getChatsFilePath();
  ensureTestDir();
  writeFileSync(file, content, "utf8");
}

function clearChatsFile(): void {
  const file = getChatsFilePath();
  if (existsSync(file)) unlinkSync(file);
  // Also clean up any temp files in the same dir
  const dir = dirname(file);
  try {
    for (const f of readdirSync(dir)) {
      if (f.startsWith("telegram-chats") || f.endsWith(".tmp." + process.pid)) {
        try { unlinkSync(join(dir, f)); } catch {}
      }
    }
  } catch {}
}

function cleanupDir(): void {
  try {
    if (existsSync(TEST_DIR)) {
      for (const f of readdirSync(TEST_DIR)) {
        try { unlinkSync(join(TEST_DIR, f)); } catch {}
      }
      try { rmdirSync(TEST_DIR); } catch {}
    }
  } catch {}
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Tests ───────────────────────────────────────────────────────────────

test("loadChatState returns default when file is missing", () => {
  setTestFile("t1.json");
  clearChatsFile();
  const chatId = 12345;
  const state = loadChatState(chatId);
  assert.strictEqual(state.chatId, chatId);
  assert.ok(typeof state.updatedAt === "string");
  assert.strictEqual(state.workspacePath, undefined);
  assert.strictEqual(state.sessionId, undefined);
  assert.strictEqual(state.lastStatus, undefined);
});

test("loadChatState merges partial stored object", () => {
  setTestFile("t2.json");
  const chatId = 54321;
  const store = {
    chats: {
      [String(chatId)]: {
        chatId,
        workspacePath: "/some/path",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
    },
  };
  writeChatsFile(JSON.stringify(store));

  const state = loadChatState(chatId);
  assert.strictEqual(state.chatId, chatId);
  assert.strictEqual(state.workspacePath, "/some/path");
  assert.strictEqual(state.sessionId, undefined);
  assert.strictEqual(state.lastStatus, undefined);
  assert.strictEqual(state.updatedAt, "2024-01-01T00:00:00.000Z");
});

test("loadChatState handles bad JSON — returns default, file not corrupted", () => {
  setTestFile("t3.json");
  writeChatsFile("invalid json{{{");
  const chatId = 55555;
  const state = loadChatState(chatId);
  assert.strictEqual(state.chatId, chatId);
  assert.ok(typeof state.updatedAt === "string");

  // File should still be intact (not overwritten by the loader)
  assert.ok(existsSync(getChatsFilePath()));
});

test("loadChatState handles missing chats key — returns default", () => {
  setTestFile("t4.json");
  writeChatsFile(JSON.stringify({ foo: "bar" }));
  const chatId = 66666;
  const state = loadChatState(chatId);
  assert.strictEqual(state.chatId, chatId);
  assert.strictEqual(state.workspacePath, undefined);
});

test("saveChatState persists patch atomically", async () => {
  setTestFile("t5.json");
  clearChatsFile();
  const chatId = 77777;

  // Initial load — no file, so defaults
  let state = loadChatState(chatId);
  assert.strictEqual(state.workspacePath, undefined);

  // Save a patch
  saveChatState(chatId, { workspacePath: "/new/workspace", lastStatus: "running" });

  // Wait for debounce flush
  await wait(600);
  const updated = loadChatState(chatId);
  assert.strictEqual(updated.workspacePath, "/new/workspace");
  assert.strictEqual(updated.lastStatus, "running");
  assert.ok(typeof updated.updatedAt === "string");
});

test("saveChatState merges with existing state", async () => {
  setTestFile("t6.json");
  clearChatsFile();
  const chatId = 88888;

  // First save: workspacePath
  saveChatState(chatId, { workspacePath: "/first/path" });
  await wait(600);
  let s1 = loadChatState(chatId);
  assert.strictEqual(s1.workspacePath, "/first/path");

  // Second save: only sessionId — workspacePath should persist
  saveChatState(chatId, { sessionId: "abc-123" });
  await wait(600);
  const s2 = loadChatState(chatId);
  assert.strictEqual(s2.workspacePath, "/first/path");
  assert.strictEqual(s2.sessionId, "abc-123");
});

test("saveChatState creates file if missing", async () => {
  setTestFile("t7.json");
  clearChatsFile();
  const chatId = 99999;
  assert.strictEqual(existsSync(getChatsFilePath()), false);

  saveChatState(chatId, { workspacePath: "/tmp" });
  await wait(600);
  assert.ok(existsSync(getChatsFilePath()));
  const data = JSON.parse(readFileSync(getChatsFilePath(), "utf8"));
  assert.ok(data.chats[String(chatId)]);
});

afterEach(() => {
  clearChatsFile();
  cleanupDir();
});
