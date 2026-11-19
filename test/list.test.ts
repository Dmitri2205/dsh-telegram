import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "../src/server/router.ts";
import { setChatsFile, getChatsFilePath } from "../src/server/state.ts";
import { existsSync, writeFileSync, unlinkSync, mkdirSync, readdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";

// ── Helpers ─────────────────────────────────────────────────────────────
// Mirrors the project's node:test style: each behaviour is its own test(),
// the ctx is built inline (no shared single-test block), and every test
// isolates its chat-state file so blocks never leak into each other.

const TEST_DIR = "/tmp/dsh-telegram-list-test-" + process.pid;

function ensureTestDir(): void {
  mkdirSync(TEST_DIR, { recursive: true });
}

function setTestFile(name: string): void {
  ensureTestDir();
  setChatsFile(join(TEST_DIR, name));
}

function clearChatsFile(): void {
  const file = getChatsFilePath();
  if (existsSync(file)) unlinkSync(file);
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

// Write an isolated chats file for one chat (no workspace selected unless asked).
function setup(chatId: number, workspacePath?: string, sessionId?: string): any {
  ensureTestDir();
  setChatsFile(join(TEST_DIR, `chat-${chatId}.json`));
  const entry: Record<string, unknown> = { chatId, updatedAt: new Date().toISOString() };
  if (workspacePath) entry.workspacePath = workspacePath;
  if (sessionId) entry.sessionId = sessionId;
  writeFileSync(getChatsFilePath(), JSON.stringify({ chats: { [String(chatId)]: entry } }, null, 2), "utf8");
  return { chatId, workspacePath };
}

// A shared mock bot that records every sent text so tests can assert on it.
function makeBot(): { sent: Array<{ chatId: number; text: string }>; sendText: any } {
  const sent: Array<{ chatId: number; text: string }> = [];
  return {
    sent,
    sendText: async (chatId: number | string, text: string) => {
      sent.push({ chatId: Number(chatId), text });
    },
  };
}

// Build a ctx with the agents/logger mocks createRouter always needs.
// `workspaceRegistry` is a plain field (there is no ctx.get in tests), which is
// exactly the fallback path getWorkspaceRegistry() takes.
function makeCtx(options: {
  workspaceRegistry?: any;
  sessions?: any;
  sessionPersistence?: any;
  sessionProjections?: any;
  sessionProjectionCache?: any;
} = {}): any {
  const created: any[] = [];
  const warnings: string[] = [];
  const ctx: any = {
    agents: {
      created,
      create: async (opts: any) => {
        created.push(opts);
        return { agent: { id: "s", session: { id: "s" } }, dispose: async () => {} };
      },
    },
    logger: {
      debug: () => {},
      info: () => {},
      warn: (msg: string) => { warnings.push(msg); },
      error: () => {},
    },
    warnings,
  };
  if ("workspaceRegistry" in options) ctx.workspaceRegistry = options.workspaceRegistry;
  if ("sessions" in options) ctx.sessions = options.sessions;
  if ("sessionPersistence" in options) ctx.sessionPersistence = options.sessionPersistence;
  if ("sessionProjections" in options) ctx.sessionProjections = options.sessionProjections;
  if ("sessionProjectionCache" in options) ctx.sessionProjectionCache = options.sessionProjectionCache;
  return ctx;
}

// Workspace registry mock: one entry per workspace path, plus the archive set.
function registry(
  workspaces: Array<{ path: string; sessionIds: string[] }>,
  archivedSessionIds: string[] = [],
): any {
  return {
    list: () => workspaces.map((ws) => ({
      id: ws.path,
      path: ws.path,
      title: ws.path,
      sessionIds: ws.sessionIds,
    })),
    archivedSessionIds,
  };
}

// Flat persistence record (no header): metadata + optional title live on top level.
function record(id: string, createdAt?: number | string, title?: string, extra: Record<string, unknown> = {}): any {
  const rec: any = { sessionId: id, ...extra };
  if (createdAt !== undefined) rec.createdAt = createdAt;
  if (title !== undefined) rec.title = title;
  return rec;
}

// Runtime persistence snapshot: metadata lives under header; title may be flat.
function snapshot(id: string, createdAt: number | string, title?: string): any {
  const rec: any = { header: { id, createdAt } };
  if (title !== undefined) rec.title = title;
  return rec;
}

// Durable projection cache keyed by header id — supplies titles without
// relying on a live session store.
function cacheTitles(titles: Record<string, string>, calls: any[] = []): any {
  return {
    cachedSnapshot: (header: any, keys?: readonly string[]) => {
      calls.push({ header, keys });
      return { values: { title: titles[header?.id] } };
    },
  };
}

function linesOf(text: string): string[] {
  return text.split("\n").filter((line) => line.includes(" · "));
}

// ── Workspace selection / registry lookup ───────────────────────────────

test("listWorkspaceSessions — no workspace selected → ⚠️ with /ws hint", async () => {
  setup(11111);

  const router = createRouter(makeBot(), makeCtx({ workspaceRegistry: registry([]) }));

  const result = await (router as any).listWorkspaceSessions(11111);
  assert.ok(result.text.includes("⚠️"), `Expected ⚠️, got: ${result.text}`);
  assert.ok(result.text.includes("/ws"), `Expected /ws mention, got: ${result.text}`);
});

test("listWorkspaceSessions — workspace absent from the registry → ⚠️ 'не найден в реестре'", async () => {
  setup(22222, "/tmp/ws-registry-missing");

  const ctx = makeCtx({
    workspaceRegistry: registry([{ path: "/tmp/some-other-ws", sessionIds: ["x"] }]),
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(22222);
  assert.ok(result.text.includes("⚠️"), `Expected ⚠️, got: ${result.text}`);
  assert.ok(result.text.includes("не найден в реестре"), `Expected registry message, got: ${result.text}`);
  assert.ok(result.text.includes("/tmp/ws-registry-missing"), "Path must be named in the message");
});

test("listWorkspaceSessions — empty workspaceRegistry → ⚠️ branch without throwing", async () => {
  setup(23333, "/tmp/ws-empty-registry");

  const ctx = makeCtx({ workspaceRegistry: {} });
  const router = createRouter(makeBot(), ctx);

  await assert.doesNotReject((router as any).listWorkspaceSessions(23333));
  const result = await (router as any).listWorkspaceSessions(23333);
  assert.ok(result.text.includes("⚠️"), `Expected ⚠️, got: ${result.text}`);
  assert.ok(result.text.includes("не найден в реестре"), `Expected registry message, got: ${result.text}`);
});

// ── Empty / archived-only lists ─────────────────────────────────────────

test("listWorkspaceSessions — workspace with no sessionIds → exact 'не найдено' text", async () => {
  setup(24444, "/tmp/ws-empty");

  let persistenceCalls = 0;
  const ctx = makeCtx({
    workspaceRegistry: registry([{ path: "/tmp/ws-empty", sessionIds: [] }]),
    sessionPersistence: {
      list: async () => {
        persistenceCalls += 1;
        return [record("telegram-ignored", Date.now(), "Не должна появиться")];
      },
    },
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(24444);
  assert.strictEqual(result.text, '📂 Живых сессий в "/tmp/ws-empty" не найдено.');
  assert.strictEqual(persistenceCalls, 0, "Persistence must not be consulted when there are no live ids");
});

test("listWorkspaceSessions — all sessionIds archived → message names the archive count", async () => {
  setup(25555, "/tmp/ws-all-archived");

  const ctx = makeCtx({
    workspaceRegistry: registry(
      [{ path: "/tmp/ws-all-archived", sessionIds: ["arch-1", "arch-2"] }],
      ["arch-1", "arch-2"],
    ),
    sessionPersistence: {
      list: async () => [
        record("arch-1", Date.now(), "Архив один"),
        record("arch-2", Date.now() - 60_000, "Архив два"),
      ],
    },
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(25555);
  assert.strictEqual(
    result.text,
    '📂 В "/tmp/ws-all-archived" нет живых сессий — все 2 в архиве.',
  );
  assert.ok(!result.text.includes("Архив один"), "Archived session titles must not be listed");
});

test("listWorkspaceSessions — archived ids excluded, remaining live ids shown", async () => {
  setup(26666, "/tmp/ws-archive-mix");

  const ctx = makeCtx({
    workspaceRegistry: registry(
      [{ path: "/tmp/ws-archive-mix", sessionIds: ["live-1", "arch-1"] }],
      ["arch-1"],
    ),
    sessionPersistence: {
      list: async () => [
        record("live-1", Date.now(), "Живая сессия"),
        record("arch-1", Date.now() - 60_000, "Архивная сессия"),
      ],
    },
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(26666);
  assert.ok(result.text.includes("Живая сессия"), `Expected live title, got: ${result.text}`);
  assert.ok(!result.text.includes("Архивная сессия"), "Archived session must not leak into the list");
  assert.ok(result.text.includes('(1):'), `Header must count only live ids: ${result.text}`);
});

// ── Ordering ────────────────────────────────────────────────────────────

test("listWorkspaceSessions — sorts by createdAt as epoch milliseconds, newest first", async () => {
  setup(27777, "/tmp/ws-sort-ms");

  const now = Date.now();
  const ctx = makeCtx({
    workspaceRegistry: registry([
      { path: "/tmp/ws-sort-ms", sessionIds: ["ms-old", "ms-mid", "ms-new"] },
    ]),
    sessionPersistence: {
      // Deliberately shuffled to prove the sort actually runs.
      list: async () => [
        record("ms-old", now - 2 * 3600_000, "Самый старый"),
        record("ms-new", now, "Самый новый"),
        record("ms-mid", now - 3600_000, "Средний"),
      ],
    },
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(27777);
  const newest = result.text.indexOf("Самый новый");
  const middle = result.text.indexOf("Средний");
  const oldest = result.text.indexOf("Самый старый");
  assert.ok(newest >= 0 && middle >= 0 && oldest >= 0, `All sessions must be listed: ${result.text}`);
  assert.ok(newest < middle && middle < oldest, `Expected newest→oldest order: ${result.text}`);
});

test("listWorkspaceSessions — sorts by createdAt as ISO strings, newest first", async () => {
  setup(28888, "/tmp/ws-sort-iso");

  const ctx = makeCtx({
    workspaceRegistry: registry([
      { path: "/tmp/ws-sort-iso", sessionIds: ["iso-old", "iso-new"] },
    ]),
    sessionPersistence: {
      list: async () => [
        record("iso-old", new Date(2026, 0, 1, 10, 0, 0).toISOString(), "ISO старая"),
        record("iso-new", new Date(2026, 0, 3, 10, 0, 0).toISOString(), "ISO новая"),
      ],
    },
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(28888);
  const newer = result.text.indexOf("ISO новая");
  const older = result.text.indexOf("ISO старая");
  assert.ok(newer >= 0 && older >= 0, `Both sessions must be listed: ${result.text}`);
  assert.ok(newer < older, `Newest ISO timestamp must be listed first: ${result.text}`);
});

// ── Rendering ───────────────────────────────────────────────────────────

test("listWorkspaceSessions — current session marked '▶ ', others with two spaces", async () => {
  setup(29999, "/tmp/ws-marker", "telegram-current");

  const ctx = makeCtx({
    workspaceRegistry: registry([
      { path: "/tmp/ws-marker", sessionIds: ["telegram-current", "telegram-other"] },
    ]),
    sessionPersistence: {
      list: async () => [
        record("telegram-current", Date.now(), "Текущая"),
        record("telegram-other", Date.now() - 60_000, "Другая"),
      ],
    },
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(29999);
  const rows = linesOf(result.text);

  const current = rows.find((line) => line.includes("Текущая"));
  const other = rows.find((line) => line.includes("Другая"));
  assert.ok(current, `Current session row missing: ${result.text}`);
  assert.ok(other, `Other session row missing: ${result.text}`);
  assert.ok(current!.startsWith("▶ "), `Current row must start with the marker: ${current}`);
  assert.ok(other!.startsWith("  "), `Other row must start with two spaces: ${other}`);
  assert.ok(!other!.startsWith("▶"), "Only the current session gets the marker");
});

test("listWorkspaceSessions — row is '<marker><dd.MM HH:MM> · <title>', no id and no event count", async () => {
  setup(31111, "/tmp/ws-format", "telegram-format-9f3c");

  const createdAt = new Date(2026, 0, 5, 9, 7, 0).getTime();
  const ctx = makeCtx({
    workspaceRegistry: registry([
      { path: "/tmp/ws-format", sessionIds: ["telegram-format-9f3c"] },
    ]),
    sessionPersistence: {
      list: async () => [
        record("telegram-format-9f3c", createdAt, "Заголовок", { eventCount: 98765 }),
      ],
    },
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(31111);
  const rows = linesOf(result.text);

  assert.strictEqual(rows.length, 1, `Exactly one session row expected: ${result.text}`);
  assert.strictEqual(rows[0], "▶ 05.01 09:07 · Заголовок");
  assert.ok(!result.text.includes("telegram-format-9f3c"), "Session id must not appear");
  assert.ok(!result.text.includes("98765"), "Event count must not appear");
  assert.ok(!/events/i.test(result.text), `No 'events' wording allowed: ${result.text}`);
});

// ── Titles ──────────────────────────────────────────────────────────────

test("listWorkspaceSessions — live projection title wins over the durable cache", async () => {
  setup(32222, "/tmp/ws-live-title");

  const header = { id: "telegram-live-title", cwd: "/tmp/ws-live-title", createdAt: Date.now() };
  const live = { header };
  const liveCalls: any[] = [];
  const cacheCalls: any[] = [];
  const ctx = makeCtx({
    workspaceRegistry: registry([
      { path: "/tmp/ws-live-title", sessionIds: ["telegram-live-title"] },
    ]),
    sessions: { get: (id: string) => id === "telegram-live-title" ? live : undefined },
    sessionPersistence: { list: async () => [{ header, title: "Из записи" }] },
    sessionProjections: {
      cachedSnapshot: (arg: unknown, keys?: readonly string[]) => {
        liveCalls.push({ arg, keys });
        return { values: { title: "Живая проекция" } };
      },
    },
    sessionProjectionCache: cacheTitles({ "telegram-live-title": "Устаревший кэш" }, cacheCalls),
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(32222);

  assert.strictEqual(liveCalls.length, 1, "Live projection must be consulted once");
  assert.strictEqual(liveCalls[0].arg, live, "Live projection must receive the live session object");
  assert.deepEqual(liveCalls[0].keys, ["title"], "Only the title projection is requested");
  assert.ok(result.text.includes("Живая проекция"), `Expected live title, got: ${result.text}`);
  assert.ok(!result.text.includes("Устаревший кэш"), "Durable cache must lose to the live title");
  assert.strictEqual(cacheCalls.length, 0, "Durable cache must not be consulted when the live title exists");
});

test("listWorkspaceSessions — falls back to durable cache keyed by the persistence header", async () => {
  setup(33333, "/tmp/ws-cache-title");

  const header = { id: "telegram-cache-title", cwd: "/tmp/ws-cache-title", createdAt: Date.now() };
  const cacheCalls: any[] = [];
  const ctx = makeCtx({
    workspaceRegistry: registry([
      { path: "/tmp/ws-cache-title", sessionIds: ["telegram-cache-title"] },
    ]),
    sessionPersistence: { list: async () => [{ header }] },
    sessionProjectionCache: cacheTitles({ "telegram-cache-title": "Из кэша" }, cacheCalls),
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(33333);

  assert.strictEqual(cacheCalls.length, 1, "Durable cache must be consulted once");
  assert.strictEqual(cacheCalls[0].header, header, "Cache must be keyed by the persistence header");
  assert.deepEqual(cacheCalls[0].keys, ["title"], "Only the title projection is requested");
  assert.ok(result.text.includes("Из кэша"), `Expected cached title, got: ${result.text}`);
});

test("listWorkspaceSessions — flat persistence title field is used", async () => {
  setup(34444, "/tmp/ws-flat-title");

  const ctx = makeCtx({
    workspaceRegistry: registry([
      { path: "/tmp/ws-flat-title", sessionIds: ["telegram-flat-title"] },
    ]),
    sessionPersistence: {
      list: async () => [record("telegram-flat-title", Date.now(), "Из плоской записи")],
    },
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(34444);
  assert.ok(result.text.includes("Из плоской записи"), `Expected flat title, got: ${result.text}`);
});

test("listWorkspaceSessions — no title anywhere → 'Без названия'", async () => {
  setup(35555, "/tmp/ws-untitled");

  const ctx = makeCtx({
    workspaceRegistry: registry([
      { path: "/tmp/ws-untitled", sessionIds: ["telegram-untitled"] },
    ]),
    sessionPersistence: { list: async () => [record("telegram-untitled", Date.now())] },
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(35555);
  assert.ok(result.text.includes("Без названия"), `Expected untitled fallback, got: ${result.text}`);
});

test("listWorkspaceSessions — whitespace-only title is rejected → 'Без названия'", async () => {
  setup(36666, "/tmp/ws-blank-title");

  const ctx = makeCtx({
    workspaceRegistry: registry([
      { path: "/tmp/ws-blank-title", sessionIds: ["telegram-blank-title"] },
    ]),
    sessionPersistence: { list: async () => [record("telegram-blank-title", Date.now(), "   ")] },
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(36666);
  assert.ok(result.text.includes("Без названия"), `Expected untitled fallback, got: ${result.text}`);
  assert.ok(!result.text.includes(" ·    "), `Whitespace-only title must not be rendered: ${result.text}`);
});

test("listWorkspaceSessions — throwing projection services do not break the list", async () => {
  setup(37777, "/tmp/ws-title-throw");

  const header = { id: "telegram-title-throw", cwd: "/tmp/ws-title-throw", createdAt: Date.now() };
  const ctx = makeCtx({
    workspaceRegistry: registry([
      { path: "/tmp/ws-title-throw", sessionIds: ["telegram-title-throw"] },
    ]),
    sessions: { get: () => ({ header }) },
    sessionPersistence: { list: async () => [{ header, title: "Запасной заголовок" }] },
    sessionProjections: { cachedSnapshot: () => { throw new Error("projections unavailable"); } },
    sessionProjectionCache: { cachedSnapshot: () => { throw new Error("cache unavailable"); } },
  });
  const router = createRouter(makeBot(), ctx);

  await assert.doesNotReject((router as any).listWorkspaceSessions(37777));
  const result = await (router as any).listWorkspaceSessions(37777);

  assert.ok(result.text.includes("Запасной заголовок"), `Expected flat-title fallback, got: ${result.text}`);
  assert.ok(result.text.includes('📂 Живые сессии в "/tmp/ws-title-throw" (1):'),
    `List must still render with its header: ${result.text}`);
});

// ── Persistence availability / missing metadata ─────────────────────────

test("listWorkspaceSessions — no sessionPersistence → rows still shown with '—' time", async () => {
  setup(38888, "/tmp/ws-no-persistence");

  const ctx = makeCtx({
    workspaceRegistry: registry([
      { path: "/tmp/ws-no-persistence", sessionIds: ["telegram-no-persist"] },
    ]),
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(38888);
  assert.strictEqual(linesOf(result.text).length, 1, `Row expected without persistence: ${result.text}`);
  assert.ok(result.text.includes("— · Без названия"), `Expected dash time + untitled: ${result.text}`);
  assert.ok(result.text.includes('(1):'), `Expected total (1): ${result.text}`);
});

test("listWorkspaceSessions — sessionPersistence.list() throws → swallowed, rows rendered", async () => {
  setup(39999, "/tmp/ws-persist-throw");

  const ctx = makeCtx({
    workspaceRegistry: registry([
      { path: "/tmp/ws-persist-throw", sessionIds: ["telegram-throw"] },
    ]),
    sessionPersistence: {
      list: async () => { throw new Error("persistence offline"); },
    },
  });
  const router = createRouter(makeBot(), ctx);

  await assert.doesNotReject((router as any).listWorkspaceSessions(39999));
  const result = await (router as any).listWorkspaceSessions(39999);

  assert.ok(result.text.includes('📂 Живые сессии в "/tmp/ws-persist-throw" (1):'),
    `List must still render: ${result.text}`);
  assert.ok(result.text.includes("— · Без названия"), `Expected dash time fallback: ${result.text}`);
  assert.ok(ctx.warnings.some((m: string) => m.includes("sessionPersistence.list() failed")),
    "The swallowed failure should be logged");
});

test("listWorkspaceSessions — registry id missing from persistence is still shown", async () => {
  setup(41111, "/tmp/ws-orphan");

  const ctx = makeCtx({
    workspaceRegistry: registry([
      { path: "/tmp/ws-orphan", sessionIds: ["telegram-orphan"] },
    ]),
    sessionPersistence: {
      list: async () => [record("some-other-session", Date.now(), "Чужая запись")],
    },
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(41111);
  assert.ok(result.text.includes("— · Без названия"), `Orphan id must render: ${result.text}`);
  assert.ok(!result.text.includes("Чужая запись"), "Persistence entries outside the registry must not be listed");
  assert.ok(result.text.includes('(1):'), `Expected total (1): ${result.text}`);
  assert.ok(!result.text.includes("telegram-orphan"), "Session id must not appear");
});

// ── Limit / header ──────────────────────────────────────────────────────

test("listWorkspaceSessions — 15 sessions → 10 rows, '…и ещё 5', total (15) in header", async () => {
  setup(42222, "/tmp/ws-limit");

  const now = Date.now();
  const ids = Array.from({ length: 15 }, (_, i) => `telegram-limit-${i}`);
  const ctx = makeCtx({
    workspaceRegistry: registry([{ path: "/tmp/ws-limit", sessionIds: ids }]),
    sessionPersistence: {
      list: async () => ids.map((id, i) => record(id, now - i * 60_000, `Сессия ${i}`)),
    },
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(42222);
  const rows = linesOf(result.text);

  assert.ok(result.text.includes('📂 Живые сессии в "/tmp/ws-limit" (15):'),
    `Expected total in header, got: ${result.text}`);
  assert.ok(result.text.includes("…и ещё 5"), `Expected "…и ещё 5", got: ${result.text}`);
  assert.strictEqual(rows.length, 10, "Only the first 10 sessions are rendered");
  assert.ok(result.text.includes("Сессия 0"), "Newest session must be shown");
  assert.ok(result.text.includes("Сессия 9"), "Tenth session must be shown");
  assert.ok(!result.text.includes("Сессия 10"), "Eleventh session must be cut by the limit");
  assert.ok(!result.text.includes("Сессия 14"), "Older sessions must be cut by the limit");
});

test("listWorkspaceSessions — exactly 10 sessions → no '…и ещё' tail", async () => {
  setup(43333, "/tmp/ws-exact-limit");

  const now = Date.now();
  const ids = Array.from({ length: 10 }, (_, i) => `telegram-exact-${i}`);
  const ctx = makeCtx({
    workspaceRegistry: registry([{ path: "/tmp/ws-exact-limit", sessionIds: ids }]),
    sessionPersistence: {
      list: async () => ids.map((id, i) => record(id, now - i * 60_000, `Точная ${i}`)),
    },
  });
  const router = createRouter(makeBot(), ctx);

  const result = await (router as any).listWorkspaceSessions(43333);

  assert.strictEqual(linesOf(result.text).length, 10);
  assert.ok(!result.text.includes("…и ещё"), "No tail when the limit is not exceeded");
  assert.ok(result.text.includes('(10):'), `Expected total (10), got: ${result.text}`);
});

// ── Routing ─────────────────────────────────────────────────────────────

test("listWorkspaceSessions — /list via routeMessage sends the list and does not create an agent", async () => {
  setup(44444, "/tmp/ws-route");

  const ctx = makeCtx({
    workspaceRegistry: registry([{ path: "/tmp/ws-route", sessionIds: ["telegram-route"] }]),
    sessionPersistence: { list: async () => [record("telegram-route", Date.now(), "Сессия из /list")] },
  });
  const bot = makeBot();
  const router = createRouter(bot, ctx);

  await router.routeMessage(44444, { text: "/list" });

  assert.strictEqual(bot.sent.length, 1, "Should send exactly one message");
  assert.strictEqual(ctx.agents.created.length, 0, "No agent should be created by /list");
  assert.ok(bot.sent[0].text.includes("Сессия из /list"), `Expected live list, got: ${bot.sent[0].text}`);
});

afterEach(() => {
  clearChatsFile();
  cleanupDir();
});
