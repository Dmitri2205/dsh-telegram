# AGENTS.md — Руководство для агентов-оркестраторов

> **Дата последнего обновления:** текущая сессия
> **Статус:** на паузе после подзадачи 5. Требуется исправление + продолжение с подзадачи 6.

---

## 1. Что это за проект

Плагин `dsh-telegram` — Telegram-бот для управления сессиями агентов DSH (DeepSeek Harness).
Бот работает в режиме вебхука, позволяет из чата:
- выбирать воркспейс,
- создавать/останавливать/просматривать сессии,
- видеть список сессий воркспейса.

Плагин — npm-пакет (`@local/dsh-telegram`), устанавливается в DSH-профиль как бандл.

---

## 2. Структура проекта

```
dsh-telegram/
  src/server/
    index.ts          # Точка входа: name, inject, apply()
    router.ts         # Маршрутизация: команды, сессии, агенты
    commands.ts       # Парсинг команд (/ws, /new, /stop, /status, /list, /help)
    state.ts          # Хранилище ChatState (debounce + atomic write)
    workspaces.ts     # Работа с workspaceRegistry
    telegram.ts       # Клиент Telegram API
    webhook.ts        # Обработчик webhook
    media.ts          # Обработка фото/документов
    proxy.ts          # HTTP-прокси
  test/
    state.test.ts     # Тесты state.ts
    workspaces.test.ts# Тесты workspaces.ts
    new.test.ts       # Тесты createNewSession
    stop.test.ts      # Тесты stop()
    status.test.ts    # Тесты getStatus()
    commands.test.ts  # Тесты команд (общий)
    helper.ts         # Мок-объекты для тестов
    router.test.ts    # Тесты router
    telegram.test.ts  # Тесты TelegramBot
    webhook.test.ts   # Тесты webhook
    media.test.ts     # Тесты media
  package.json
  tsconfig.json
  build.js
  cordis.patch.yml
```

---

## 3. Документация по написанию плагинов

**Обязательно читай:** `/home/dmitry/dsh_plugins/README.md`

Ключевые правила:
- `export const name`, `export const inject`, `export function apply` — **никакого `export default`**.
- Необязательные сервисы — через `ctx.get(...)`, не через `ctx.<name>`.
- `kind` обязателен в `register({ kind, path, handler })`.
- Секреты — в `~/.dsh/<плагин>-settings.json` (0o600), не в `cordis.patch.yml`.
- Сборка: `npx tsc --noEmit && npm test` → `node build.js` → `pnpm install --force` → рестарт → `journalctl`.

---

## 4. Что УЖЕ сделано (подзадачи 1–5)

### Подзадача 1. Хранилище состояния чата ✅

**Файл:** `src/server/state.ts`

- Интерфейс `ChatState`: `{ chatId, workspacePath?, sessionId?, lastStatus?, updatedAt }`.
- Формат файла: `~/.dsh/telegram-chats.json` → `{ chats: Record<string, ChatState> }`.
- `loadChatState(chatId)` — синхронное чтение, дефолт при отсутствии/ошибке.
- `saveChatState(chatId, patch)` — debounce 500ms, атомарная запись (temp + rename).
- `setChatsFile(path)` — для тестов.

**Тесты:** `test/state.test.ts` — 5 тестов, все проходят.

### Подзадача 2. Список и выбор воркспейсов (`/ws`) ✅

**Файлы:** `src/server/workspaces.ts`, `src/server/router.ts` (изменён)

- `listWorkspaces(ctx)` → массив `{ index, id, path, title, sessionCount }`.
- `resolveWorkspace(ctx, selector)` — по номеру (1-based) или по абсолютному пути.
- Команды `/ws` (список с `*` на текущем), `/ws N` (выбор), `/ws <путь>`.
- `cwd` при `agents.create` берётся из `state.workspacePath`, fallback — `process.cwd()`.

**Тесты:** `test/workspaces.test.ts` — 15 тестов, все проходят.

### Подзадача 3. Новая сессия в воркспейсе (`/new`) ✅

**Файлы:** `src/server/router.ts` (изменён), `src/server/commands.ts` (изменён)

- `createNewSession(chatId)`:
  - Проверяет `workspacePath` (иначе ошибка со ссылкой на `/ws`).
  - Создаёт сессию: `ctx.agents.create({ sessionId, meta: { cwd: workspacePath } })`.
  - Вызывает `workspace.attachSession(sessionId)`.
  - Сохраняет `sessionId` в state.
  - Возвращает: `🆕 Сессия <short-id> в <title> (<path>)`.

**Тесты:** `test/new.test.ts` — 4 теста, все проходят.

### Подзадача 4. Остановка генерации (`/stop`) ✅

**Файлы:** `src/server/router.ts` (изменён), `src/server/commands.ts` (изменён)

- `router.stop(chatId)`:
  - Нет агента или `status === 'idle'` → `false`.
  - Иначе `agent.cancel({ kind: 'user' })` → `await whenIdle()` → очистка кэша.
- Алиас `/cancel`.

**Тесты:** `test/stop.test.ts` — 4 теста + обновления `test/commands.test.ts`.

### Подзадача 5. Статус агента (`/status`) ✅

**Файлы:** `src/server/router.ts` (изменён), `src/server/commands.ts` (изменён)

- `router.getStatus(chatId)`:
  - Нет sessionId → «нет активной сессии, /new».
  - Живой агент → статус, воркспейс, eventCount из persistence, время активности.
  - Мёртвый агент → idle + eventCount из persistence.

**Тесты:** `test/status.test.ts` — 5 тестов.

---

## 5. Текущее состояние (ошибка)

### ❌ Подзадача 6 остановлена с ошибкой компиляции

**Файл:** `src/server/router.ts`, строки 98–104

Субагент подзадачи 6 добавил `export interface PersistedSession` **внутрь** `interface RouterContext`:

```typescript
interface RouterContext {
  agents: Agents;
  logger: { info(msg: string): void; error(msg: string): void };
  cwd?: string;
  workspaceRegistry?: unknown;
  export interface PersistedSession {    // ← ОШИБКА: export внутри interface
    sessionId: string;
    title?: string;
    cwd: string;
    createdAt: string;
    eventCount?: number;
  }
  sessionPersistence?: { ... };
  get?(key: string): unknown;
}
```

**Ошибка компиляции:**
```
src/server/router.ts(98,3): error TS1131: Property or signature expected.
src/server/router.ts(107,22): error TS1109: Expression expected.
src/server/router.ts(109,5): error TS1005: ',' expected.
src/server/router.ts(112,29): error TS1005: '=>' expected.
src/server/router.ts(113,1): error TS1128: Declaration or statement expected.
```

**Как исправить:**
1. Переместить `interface PersistedSession` на уровень выше (на уровень с `RouterContext`).
2. Убрать `export` (он не нужен, интерфейс используется только внутри файла).

---

## 6. Что нужно сделать дальше

### Шаг 1: Исправить ошибку в router.ts

Переместить `interface PersistedSession` из `RouterContext` на верхний уровень файла `router.ts`.

### Шаг 2: Подзадача 6 — `/list` сессий воркспейса

**Файлы:** `src/server/router.ts` (метод `listWorkspaceSessions` уже есть), `src/server/commands.ts` (нужно добавить case), `test/list.test.ts` (новый).

Требования:
- `sessionPersistence.list()` фильтруется по `header.cwd === state.workspacePath`.
- Сортировка по `createdAt` (новые сверху), лимит 10 + «…и ещё N».
- Текущая сессия помечается `▶`.
- Команда `/list` в commands.ts.

**Примечание:** Метод `listWorkspaceSessions` уже реализован в `router.ts` (строки 314–361). Нужно добавить обработку команды `/list` в `commands.ts` и написать тесты.

### Шаг 3: Подзадача 7 — Inline-кнопки

- `webhook.ts`: `callback_query` → `router.handleCallback(chatId, data)` вместо текста `Callback: <data>`.
- Клавиатура: `reply_markup.inline_keyboard` для `/ws` и `/status`.
- `data` — компактный протокол: `ws:<index>`, `act:stop`, `act:new` (64 байта).

### Шаг 4: Подзадача 8 — Документация и проверки

- Обновить `README.md`.
- `npx tsc --noEmit`, `npm test`, `node build.js`, `pnpm install --force`, рестарт, `journalctl`.

---

## 7. Ключевые паттерны проекта

### Создание сессии
```typescript
const handle = await ctx.agents.create({
  sessionId: `telegram-${chatId}-${randomUUID()}`,
  meta: { cwd: workspacePath },
});
// ...
wsEntry.attachSession(handle.agent.session.id);
```

### Остановка сессии
```typescript
handle.agent.cancel({ kind: 'user' });
await handle.agent.whenIdle();
chatToAgent.delete(chatId);
```

### Отправка ответа
```typescript
await bot.sendText(chatId, text);
```

### Команда в commands.ts
```typescript
// case "status": return { text: await router.getStatus(chatId).text, action: "send" };
```

---

## 8. Команды для проверки

```bash
cd /home/dmitry/dsh_plugins/dsh-telegram
npx tsc --noEmit          # типчекек
npm test                   # все тесты (сейчас 87, должны стать 88+)
node build.js              # сборка
```

---

## 9. Чего НЕ делать

- Не переписывать `state.ts` — он уже реализован и протестирован.
- Не трогать `telegram.ts` и `webhook.ts` без необходимости.
- Не добавлять `export default` в `index.ts`.
- Не использовать `ctx.workspaceRegistry` без `ctx.get("workspaceRegistry")` (сервис может отсутствовать).
- Не забывать `kind: "exact" | "prefix"` в `ctx.webServer.register()`.
- Не писать токены в логи.
