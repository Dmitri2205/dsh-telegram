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

## 5. Текущее состояние — ВСЕ ПОДЗАДАЧИ ВЫПОЛНЕНЫ ✅

> **Дата завершения:** текущая сессия
> **Итог:** все 8 подзадач из BOT_COMMANDS.md реализованы, протестированы, документация обновлена.

### ✅ Подзадача 6 — `/list` сессий воркспейса

**Файлы:** `src/server/router.ts` (метод `listWorkspaceSessions`), `src/server/commands.ts` (`case "list"`), `test/list.test.ts`

- Фильтрация по `cwd === workspacePath`
- Сортировка по `createdAt` (новые сверху), лимит 10 + «…и ещё N»
- Текущая сессия помечается `▶`

### ✅ Подзадача 7 — Inline-кнопки

**Файлы:** `src/server/telegram.ts` (`answerCallbackQuery`), `src/server/router.ts` (`handleCallback`), `src/server/commands.ts` (`buildInlineKeyboard`, `reply_markup`), `src/server/webhook.ts` (`callback_query` → `handleCallback`), `src/server/index.ts`, `test/webhook.test.ts`

- `callback_query` → `router.handleCallback(chatId, data)` + `answerCallbackQuery`
- Клавиатура для `/ws` (кнопка `🆕 New Chat`) и `/status` (`⏹ Stop`, `🆕 New`)
- Протокол: `act:stop`, `act:new`, `ws:3` (неизвестные → "кнопка устарела")

### ✅ Подзадача 8 — Документация и проверки

- `README.md` обновлён: таблица команд, хранение состояния, структура
- `npx tsc --noEmit` — ✅
- `npm test` — 91/91 passed
- `node build.js` — ✅

---

## 6. Ключевые паттерны проекта

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
npm test                   # все тесты (91)
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
