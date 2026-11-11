# BOT_COMMANDS — план работ по управлению сессиями из Telegram

Задача-владелец: из чата должно быть видно, **где** работает агент, и им можно было
управлять. Минимальный набор:

1. выбор текущего воркспейса из чата;
2. `/new` — новая сессия **в выбранном воркспейсе**;
3. `/stop` — остановить генерацию в текущей сессии;
4. `/status` — статус агента в выбранной сессии.

Ниже — факты, на которые опирается реализация, и разбиение на подзадачи.
Каждую подзадачу можно отдавать отдельному агенту: она самодостаточна, имеет
критерий приёмки и не требует правок в чужих подзадачах.

---

## 0. Факты об окружении (проверено по коду харнесса)

| Факт | Где |
| --- | --- |
| `ctx.agents.create({ sessionId, meta: { cwd }, agentOptions, setup })` → `AgentHandle { agent, dispose() }` | `packages/core/agent/src/index.ts:63-140,190` |
| `ctx.agents.resume({ resumeSessionId, … })`; требует сервис `sessionPersistence` | `packages/core/agent/src/index.ts:202`, `packages/session/session-persistence/src/index.ts:141` |
| `agent.followup(userMessage)` ставит ход, `agent.whenIdle()` ждёт покоя | `packages/core/agent/src/runtime-types.ts:191-215` |
| `agent.cancel(cause, options?)`, `cause: { kind: 'user' }` | `packages/core/agent/src/runtime-types.ts:183`, `packages/core/session/src/types.ts:190-194` |
| `agent.status`: `'idle' \| 'running'`; `agent.session.id` | `packages/core/agent/src/runtime-types.ts:109,172` |
| `ctx.agents.list()` / `ctx.agents.get(id)` — живые агенты | `packages/core/agent/src/index.ts:568,588` |
| Ответ агента — событие `session/event` c `assistant/message`, текст в `event.data.message.content[]` | `packages/acp/acp/src/index.ts:135`, `packages/acp/acp/src/updates.ts:16-45` |
| `ctx.workspaceRegistry.list()` → `Workspace[]` (`id`, `path`, `title`, `sessionIds`), `create(path, title?)`, `get(id)` | `packages/workspace/workspace/src/index.ts:170-300` |
| `workspace.attachSession(sessionId)` закрепляет сессию за воркспейсом | `packages/workspace/workspace/src/entity.ts:110` |
| `ctx.sessionPersistence.list()` → `{ header: { id, cwd, createdAt }, eventCount? }` | `packages/session/session-persistence/src/index.ts:203`, `packages/core/session/src/types.ts:95-120` |
| `ctx.sessionTitle.get(session)` / `rename(session, title)` | `packages/session/session-title/src/index.ts:391,407` |
| `callback_query` в апдейте = нажатие inline-кнопки; сейчас `src/server/webhook.ts:113-121` превращает его в текст `Callback: <data>` | `src/server/webhook.ts` |

Текущее состояние плагина: `src/server/router.ts` держит `chatId → AgentHandle`
в памяти, `cwd = process.cwd()`, команды `/start|/new|/list|/help` обрабатываются
локально, выбора воркспейса нет.

---

## Подзадача 1. Хранилище состояния чата (фундамент)

Без неё остальное можно сделать только «в памяти процессa», а рестарт DSH всё теряет.

Шаги:

1. `src/server/state.ts` — тип `ChatState`:
   ```ts
   interface ChatState {
     chatId: number
     workspacePath?: string     // выбранный воркспейс (абсолютный путь)
     sessionId?: string         // активная сессия чата
     lastStatus?: 'idle' | 'running'
     updatedAt: string          // ISO
   }
   ```
2. Расширить `~/.dsh/telegram-settings.json` (или новый `~/.dsh/telegram-chats.json`,
   `mode 0o600`) полем `chats: Record<string, ChatState>`. Запись — атомарная
   (temp + `rename`), лимит размера, `try/catch` с логом.
3. `loadChatState(chatId)` / `saveChatState(patch)` — синхронный read, батч-запись
   (не чаще 1 раза в 500 мс, чтобы не переписывать файл на каждое событие).
4. Тесты: отсутствие файла → дефолт; частичный объект → мерж; битый JSON →
   дефолт + лог, файл не перезаписывается.

**Приёмка**: после рестарта DSH бот помнит выбранный воркспейс и sessionId чата.

---

## Подзадача 2. Список воркспейсов и выбор (`/ws`, `/ws 2`)

Шаги:

1. Расширить `inject` плагина: `workspaceRegistry` (в `src/server/index.ts:13`).
   Опционально — `ctx.get('workspaceRegistry')`, чтобы плагин не падал в профиле без
   воркспейсов.
2. `src/server/workspaces.ts`:
   - `listWorkspaces(ctx)` → `Array<{ index, id, path, title, sessionCount }>`
     (нумерация по `updatedAt`/порядку реестра, стабильная внутри ответа);
   - `resolveWorkspace(ctx, selector)` — по номеру из последнего показа или по
     точному `path`; неизвестный селектор → ошибка «нет такого воркспейса».
3. Команды:
   - `/ws` — список: `1. <title> — <path> (N сессий)`, текущий помечен `*`;
   - `/ws 2` — выбрать; сохранить `workspacePath` в состояние чата
     (подзадача 1); **сессию не сбрасывать** до `/new`;
   - `/ws <путь>` — явный путь (только если существует и является каталогом).
4. `router.ts`: `cwd` при `agents.create` берётся из `state.workspacePath`,
   fallback — `process.cwd()`.
5. Тесты: пустой список; выбор по номеру; выбор по пути; несуществующий индекс.

**Приёмка**: `/ws` показывает воркспейсы из реестра DSH, `/ws N` меняет каталог,
в котором стартует следующая сессия (проверяется по `header.cwd`).

---

## Подзадача 3. `/new` в выбранном воркспейсе

1. `router.newSession(chatId)` уже диспозит агента — оставить.
2. При создании агента: `meta.cwd = state.workspacePath`; после создания —
   `workspace.attachSession(session.id)` (если воркспейс известен), чтобы сессия
   появилась в дереве воркспейса в UI.
3. Ответ пользователю: `🆕 Сессия <short-id> в <title> (<path>)`.
4. Записать `sessionId` в состояние чата; при `/new` без выбранного воркспейса —
   понятная ошибка со ссылкой на `/ws`.
5. Тесты: `/new` без воркспейса → ошибка, агент не создан; `/new` с воркспейсом →
   `create` получил `meta.cwd === workspace.path`, `attachSession` вызван с новым id.

**Приёмка**: `/new` создаёт сессию именно в выбранном воркспейсе и она видна в UI DSH.

---

## Подзадача 4. `/stop` — остановка генерации

1. `router` хранит `AgentHandle` по chatId; добавить `stop(chatId): boolean`:
   - нет активного агента → `false` (бот отвечает «нечего останавливать»);
   - `agent.status === 'idle'` → `false`;
   - иначе `agent.cancel({ kind: 'user' })` и `true`.
2. После cancel — дождаться `whenIdle()` перед ответом, чтобы не писать «остановил»
   поверх ещё идущих событий; собранный частичный текст не отправлять (или
   отправить с пометкой «⏹ остановлено»).
3. Команда `/stop` (+ алиас `/cancel`) в `src/server/commands.ts`.
4. Тесты: idle → отказ; running → `cancel` с `{ kind: 'user' }` вызван ровно один раз;
   ответ содержит «остановлено».

**Приёмка**: длинная генерация прерывается из чата, после `/stop` можно сразу
отправить новое сообщение — оно пойдёт в тот же ход/сессию.

---

## Подзадача 5. `/status` — статус агента в выбранной сессии

1. Источники данных:
   - живой агент из `router` (`status`, `session.id`, время старта хода);
   - иначе `sessionPersistence.stat(sessionId)` (существует ли, `eventCount`);
   - воркспейс — из состояния чата.
2. Формат ответа:
   ```
   📊 Сессия: <short-id>
   Воркспейс: <title> (<path>)
   Статус: running (1м 12с) | idle
   Событий: 148 | последняя активность: 12:31
   ```
3. Подписка на `agent/status` (если сервис отдаёт событие) — обновлять
   `lastStatus` в состоянии чата; при отсутствии события — читать `agent.status`
   по запросу (не кешировать как истину).
4. Тесты: нет сессии → «нет активной сессии, /new»; idle; running; сессия есть в
   хранилище, но агент не жив → показывается idle + счётчик событий.

**Приёмка**: `/status` отвечает на любой чат, не создавая ход, и не падает, если
сессии нет.

---

## Подзадача 6. `/list` — сессии выбранного воркспейса

1. `sessionPersistence.list()` фильтруется по `header.cwd === state.workspacePath`;
2. сортировка по `createdAt` (новые сверху), лимит 10 + «…и ещё N»;
3. текущая сессия чата помечается `▶`.
4. Тесты: пустой воркспейс; фильтр по cwd не пропускает чужие сессии; лимит.

**Приёмка**: `/list` показывает сессии воркспейса, а не только «чаты в памяти».

---

## Подзадача 7. Inline-кнопки (после стабилизации команд)

1. `webhook.ts`: `callback_query` → `router.handleCallback(chatId, data)` вместо
   текста `Callback: <data>` (`src/server/webhook.ts:113-121`); обязательно
   `answerCallbackQuery`, иначе у клиента крутится часик.
2. Клавиатура: `reply_markup.inline_keyboard` для `/ws` (кнопка на воркспейс) и для
   `/status` (кнопки `⏹ Stop`, `🆕 New`).
3. `data` — компактный протокол: `ws:<index>`, `act:stop`, `act:new`
   (Telegram ограничивает 64 байта).
4. Тесты: неизвестный `data` → ответ «кнопка устарела»; `act:stop` дергает `stop()`.

**Приёмка**: выбор воркспейса и остановка работают тапом, без набора команд.

---

## Подзадача 8. Документация и проверки

1. Обновить `dsh-telegram/README.md`: таблица команд (`/ws`, `/new`, `/stop`,
   `/status`, `/list`, `/help`), где хранится состояние чата.
2. Обновить `~/dsh_plugins/README.md`, если появятся новые паттерны (например
   вызов `attachSession`).
3. Прогон: `npx tsc --noEmit`, `npm test`, `node build.js`,
   `cd ~/.dsh/profiles/web && pnpm install --force`, рестарт,
   `journalctl --user -u dsh-web | grep -E "did not activate|failed to import"`.
4. Ручной сценарий: `/ws` → `/ws 1` → `/new` → сообщение → `/status` (running) →
   `/stop` → `/status` (idle) → `/list`.

---

## Порядок и зависимости

```
1 state ──▶ 2 workspaces ──▶ 3 new ──▶ 4 stop ──▶ 5 status ──▶ 6 list ──▶ 7 buttons ──▶ 8 docs
                                   └──────────────┘
```

* 1 — блокирует всех, делать первой.
* 3 и 4 независимы друг от друга после 1–2.
* 5 и 6 можно параллелить после 3.
* 7 — только после 2 и 4 (кнопки дёргают уже существующие действия).

## Общие ограничения

* Все ответы на команды — локальные: команда **не** должна ставить ход агенту.
* Любая ошибка команды → текст в чат, а не молчание (иначе диагностика невозможна).
* Секреты и токены в логи не писать.
* `inject` расширяем только теми сервисами, что реально нужны; необязательные —
  через `ctx.get(...)`, иначе плагин не активируется в профиле без них.
