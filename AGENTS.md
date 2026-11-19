# AGENTS.md — Руководство для агентов-оркестраторов

> **Дата последнего обновления:** 19.11.2026
> **Статус:** подзадачи 1–8 реализованы, `/list` починен; вывод — «живые» (не архивные) сессии
> воркспейса без id, собран и ждёт проверки после рестарта (19 из 27 на текущем реестре).
> Тесты: **112/112**. Открытые дефекты рантайма и план доделок — в `FIXES.md`.
>
> **Сначала прочитай раздел 7** («Сервисы, которые появляются позже») — на нём сгорели два агента подряд.

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

**Обязательно читай:** `/home/dmitry/dsh_plugins/README.md` — там те же грабли про
поздно монтируемые сервисы (раздел 2), реестр/архив сессий (раздел 5) и сборку
без `npx` (раздел 6), разобранные на примерах `dsh-telegram`.

Ключевые правила:
- `export const name`, `export const inject`, `export function apply` — **никакого `export default`**.
- Необязательные сервисы — через `ctx.get(...)`, не через `ctx.<name>`. Сервис из `inject` (например `workspaceRegistry`) читается напрямую: `ctx.workspaceRegistry`.
- **Сервис, который может появиться позже, нельзя читать один раз при `apply()`** — см. раздел 7.
- `kind` обязателен в `register({ kind, path, handler })`.
- Секреты — в `~/.dsh/<плагин>-settings.json` (0o600), не в `cordis.patch.yml`.
- Сборка/проверка в этом окружении — см. раздел 8 (`npx`/`npm` здесь не работают).

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
>
> ✅ **`/list` и `/status` видят persistence** (19.11.2026): ключ сервиса исправлен на `sessionPersistence`,
> сервисы резолвятся лениво. Проверено на живом рантайме (на тот момент): `/list` вернул 84 сессии
> из 217 записей. Позже вывод сужен до живых не архивных сессий воркспейса — см. Подзадача 6.
> Разбор — `FIXES.md` пункт 11, механика — раздел 7 ниже.
>
> ⚠️ **Открытые дефекты рантайма:** обычные сообщения падают с «Failed to process your message» после `/new`;
> кнопки не отвечают в чат. Полный список, причины с `файл:строка` и планы правок — в `FIXES.md` (пункты 2–9).
> Зелёные тесты эти пути не покрывают: они мокают `agents` и `sessionPersistence`.

### ✅ Подзадача 6 — `/list` сессий воркспейса

**Файлы:** `src/server/router.ts` (метод `listWorkspaceSessions`), `src/server/commands.ts` (`case "list"`), `test/list.test.ts`

- Источник — реестр воркспейсов: `workspace.sessionIds` минус `archivedSessionIds`
  («живые» = прикреплённые к воркспейсу и не в архиве; старые сессии с диска вне реестра не видны)
- Если все сессии воркспейса в архиве — отдельное сообщение «все N в архиве»
- `createdAt` подтягивается из `sessionPersistence.list()`; без persistence строки идут со временем «—»
- Сортировка по `createdAt` (новые сверху), лимит 10 + «…и ещё N»
- Текущая сессия помечается `▶`
- Формат строки: `▶ 19.11 02:38 · <заголовок>` — id сессии и число событий в вывод не попадают
- Заголовок берётся из проекции `title`: живые cells (`sessionProjections.cachedSnapshot(ctx.sessions.get(id), ["title"])`)
  → durable-кэш по header (`sessionProjectionCache.cachedSnapshot(header, ["title"])`);
  если заголовка нет — «Без названия»

### ✅ Подзадача 7 — Inline-кнопки

**Файлы:** `src/server/telegram.ts` (`answerCallbackQuery`), `src/server/router.ts` (`handleCallback`), `src/server/commands.ts` (`buildInlineKeyboard`, `reply_markup`), `src/server/webhook.ts` (`callback_query` → `handleCallback`), `src/server/index.ts`, `test/webhook.test.ts`

- `callback_query` → `router.handleCallback(chatId, data)` + `answerCallbackQuery`
- Клавиатура для `/ws` (кнопка `🆕 New Chat`) и `/status` (`⏹ Stop`, `🆕 New`)
- Протокол: `act:stop`, `act:new`, `ws:3` (неизвестные → "кнопка устарела")

### ✅ Подзадача 8 — Документация и проверки

- `README.md` обновлён: таблица команд, хранение состояния, структура
- `tsc -p tsconfig.json` — ✅ (остались только средовые `TS2591`/`TS7006`)
- `tsx --test test/*.test.ts` — 112/112 passed
- `node build.js` — собирает клиент; в этом окружении не работает из-за `npx` (см. раздел 8)

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
// ОБЯЗАТЕЛЬНО: handle живого агента надо положить в кэш, иначе следующее
// сообщение уйдёт в resume() по живой сессии и упадёт с SessionAlreadyOwnedError
chatToAgent.set(chatId, handle);
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

## 7. Сервисы, которые появляются позже (грабли Cordis)

### Симптом
Команда (`/list`, `/status`) отвечает «пусто», хотя данные на диске есть, а тесты зелёные.

### Как устроено
- Сервис регистрируется в Cordis под **своим ключом**, а не под именем плагина.
  Пример: пакет `@deepseek-ai/dsh-session-persistence-jsonl` (плагин `session-persistence-jsonl`)
  регистрирует сервис под ключом **`sessionPersistence`**
  (`/home/dmitry/deepseek-harness/packages/session/session-persistence/src/index.ts` →
  `super(ctx, 'sessionPersistence')`). `override readonly name = 'session-persistence-jsonl'`
  (`…/session-persistence-jsonl/src/index.ts:293`) — только диагностическая подпись.
- Часть сервисов появляется **асинхронно**: `packages/core/agent-loop/src/index.ts:411` монтирует
  persistence через `ctx.inject(['sessionPersistence'], …)`, а бэкенд в `apply` делает
  `await service.await()`. В момент, когда наш `apply()` уже выполняется, сервиса может ещё не быть.
- `ctx.get(name)` **не бросает** исключение при отсутствии сервиса — возвращает `undefined`.
  Ошибка поэтому тихая: плагин «работает», просто с `undefined`.
- `export const inject = [...]` гарантирует, что наш `apply` вызовут только после активации этих
  сервисов, но делает их жёсткой зависимостью: без persistence плагин вообще не загрузится.
  Для необязательного сервиса `inject` — не решение.

### Правильно: ленивый резолв
Не читать сервис один раз, а резолвить при каждом обращении (`src/server/index.ts:376-397`):
```typescript
const lazyService = (name: string): any => new Proxy({}, {
  get(_target, prop) {
    let svc: any;
    try { svc = ctx.get?.(name) } catch { svc = undefined }
    const value = svc?.[prop];
    return typeof value === "function" ? value.bind(svc) : value;
  },
  has() { try { return !!ctx.get?.(name) } catch { return false } },
});
// ...
sessionPersistence: lazyService("sessionPersistence"),
agentDefaultModel: lazyService("agentDefaultModel"),
sessions: lazyService("sessions"),
sessionProjections: lazyService("sessionProjections"),
sessionProjectionCache: lazyService("sessionProjectionCache"),
```
Почему `Proxy`, а не геттер: роутер читает `ctx.sessionPersistence.list`, `…stat`, проверяет
`typeof … === "function"` — прокси отвечает на любое свойство и корректно биндит метод к сервису.

### Как проверить ключ, не запуская рантайм
```bash
grep -rn "super(ctx, '" /home/dmitry/deepseek-harness/packages/session/*/src/index.ts
grep -rn "ctx.get('sessionPersistence')\|ctx.sessionPersistence" \
  /home/dmitry/deepseek-harness/packages --include=*.ts | head
```
Ключ — первый аргумент конструктора `Service` (`super(ctx, '<key>')`).
**Имя плагина в `cordis.patch.yml` и в startup-логе (`include:session-persistence-jsonl`) — не ключ сервиса.**
Именно на этой путанице коммит `35c6929` сломал `/list`.

### Почему тесты это не ловят
`test/list.test.ts` передаёт `sessionPersistence` **напрямую** в `RouterContext` и обходит `ctx.get(...)`.
Тест, который поймал бы регрессию, должен проверять wiring в `index.ts`, а не только роутер.

---

## 8. Сборка, проверка и отладка в этом окружении

`npx` и `npm` здесь падают с **EROFS** (npm-кэш только для чтения). Используй бинарники харнесса:

```bash
cd /home/dmitry/dsh_plugins/dsh-telegram

# типы + эмит в lib/ (tsc эмитит даже при ошибках типов)
/home/dmitry/deepseek-harness/node_modules/.bin/tsc -p tsconfig.json

# тесты (112 шт.)
/home/dmitry/deepseek-harness/node_modules/.bin/tsx --test test/*.test.ts
```

Ожидаемые ошибки `tsc`: `TS2591` (`Buffer`, `node:*`, `process`) и `TS7006` в `media.ts`/`proxy.ts` —
следствие отсутствия `@types/node`. Это **не регрессии**; следи, чтобы не появлялось других.

### Куда попадает сборка
`lib/` — рабочий вывод. Установленный профиль
`~/.dsh/profiles/web/node_modules/@local/dsh-telegram/lib/` — **хардлинк** на `lib/` (один inode).
`tsc` перезаписывает файл на месте, поэтому обновляются оба. Проверка:
```bash
ls -li lib/server/index.js \
  ~/.dsh/profiles/web/node_modules/@local/dsh-telegram/lib/server/index.js   # одинаковый inode
```
Если inode разошлись (файл «разорвали» копированием) — скопируй `lib/` в профиль.
`build.js` дополнительно собирает клиент, но вызывает `npx` — здесь не работает; для серверных
правок достаточно `tsc`.

### После сборки обязателен рестарт
Плагин живёт в памяти процесса. Пока DSH не перезапущен, работает **старый** код.
Если после рестарта поведение прежнее — сначала проверь, что процесс стартовал позже сборки,
и только потом правь код снова.

### Отладка рантайма без journalctl
Рабочий приём — маркеры в файл (так был найден `/list`):
```typescript
appendFileSync("/home/dmitry/dsh_plugins/dsh-telegram/.telegram-debug.jsonl",
  JSON.stringify({ phase: "list:enter", at: new Date().toISOString(), pid: process.pid,
                   hasPersistence: !!ctx.sessionPersistence }) + "\n");
```
Рестарт → действие в Telegram → читаешь файл. Маркеры дали: `hasPersistence: true`,
`hasList: "function"`, `rawCount: 217`, `filteredCount: 84`, `error: null`.
**После починки маркеры и файл удали** (иначе они попадут в коммит и будут писать мусор).

---

## 9. Чего НЕ делать

- Не переписывать `state.ts` — он уже реализован и протестирован.
- Не трогать `telegram.ts` и `webhook.ts` без необходимости.
- Не добавлять `export default` в `index.ts`.
- Не использовать `ctx.<service>` для сервисов, которых нет в `inject` (`sessionPersistence`, `credentials`) — только `ctx.get("...")`; иначе Cordis бросит `cannot get property "..." without inject`.
- Не читать необязательный сервис **один раз** в `apply()` — только лениво (раздел 7).
- Не выводить ключ сервиса из имени плагина или startup-лога — смотри `super(ctx, '<key>')` в исходниках харнесса.
- Не считать зелёные тесты доказательством того, что wiring в `index.ts` рабочий: тесты подставляют сервисы напрямую.
- Не вызывать `ctx.agents.resume()` по сессии, которая уже живёт в процессе: `persistence.open(id, 'write')` упадёт с `SessionAlreadyOwnedError`. Сначала `ctx.agents.get(sessionId)` (см. `FIXES.md`, пункт 2).
- Не забывать `kind: "exact" | "prefix"` в `ctx.webServer.register()`.
- Не писать токены в логи.
