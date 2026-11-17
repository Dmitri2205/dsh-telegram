# FIXES.md — План доделок и журнал решений

> **Как пользоваться:** каждая запись — это одна проблема. Пока проблема открыта, в ней лежит
> **Проблема / Причина / План правки / Критерий приёмки**. Когда проблема закрыта — добавляется
> раздел **Решение** (что именно изменено, файл:строка) и статус меняется на ✅.
> Открытые пункты = актуальный план доделок плагина.
>
> **Проверки для каждого пункта:**
> ```bash
> cd /home/dmitry/dsh_plugins/dsh-telegram
> npx tsc --noEmit && npm test && node build.js
> ```

---

## 1. `/ws` возвращает "Нет доступных воркспейсов"

**Дата:** текущая сессия
**Статус:** ✅ исправлено

### Описание
Команда `/ws` возвращала «Нет доступных воркспейсов», потому что `workspaceRegistry` не был доступен в контексте плагина.

### Причина бага
В `src/server/index.ts` строка 378 `workspaceRegistry` получался через небезопасный cast:
```typescript
workspaceRegistry: (ctx as { get?(key: string): unknown } | undefined)?.get?.("workspaceRegistry"),
```
Тип `ctx` в функции `apply()` не содержал метод `get`, поэтому `ctx.get("workspaceRegistry")` всегда возвращал `undefined`.

### Исправление
3 правки в `src/server/index.ts`:

1. **Строка 13** — добавлен `"workspaceRegistry"` в массив `inject`:
   ```typescript
   export const inject = ["agents", "webServer", "workspaceRegistry"];
   ```
2. **Строка 275** — тип `ctx` дополнен полем:
   ```typescript
   workspaceRegistry?: unknown;
   ```
3. **Строка 379** — замена unsafe cast на прямой доступ:
   ```typescript
   workspaceRegistry: ctx.workspaceRegistry,
   ```

### Проверка
- `npx tsc --noEmit` — ✅ прошёл (exit code 0)
- `npm test` — ✅ 91/91 тестов прошли (exit code 0)

---

## 2. P1 — «⚠️ Failed to process your message» на любом обычном сообщении

**Статус:** ❌ открыто (причина найдена, правка не внесена)

### Проблема
`/ws` и `/new` работают. Любое обычное текстовое сообщение после них бот отвечает
«⚠️ Failed to process your message. Please try again or use /new to start a fresh session.».

### Причина
`createNewSession` (`src/server/router.ts:422-470`) вызывает
`ctx.agents.create({ sessionId, meta: { cwd: workspacePath } })` (`src/server/router.ts:439-442`)
и **не кладёт полученный handle в `chatToAgent`** — только `chatToSession.set(chatId, actualSessionId)`
(`src/server/router.ts:456`) и `saveChatState(chatId, { sessionId })` (`src/server/router.ts:459`).

Поэтому после `/new` живой агент существует, но кэш плагина пуст. Следующее обычное сообщение идёт в
`ensureAgent` (`src/server/router.ts:132-160`) → промах кэша → `ctx.agents.resume({ resumeSessionId })`
(`src/server/router.ts:143-144`) по **уже живой** сессии. В харнессе `resume` первым делом берёт
write-ownership: `persistence.open(id, 'write')` (`/home/dmitry/deepseek-harness/packages/core/agent-loop/src/index.ts:876`,
комментарий «a live agent's handle holds the claim»), при `EBUSY` бросается `SessionAlreadyOwnedError`
(`/home/dmitry/deepseek-harness/packages/session/session-persistence-jsonl/src/lease.ts:82`).
Ошибка попадает в catch `src/server/router.ts:188-192` → пользователю уходит «Failed to process your message».

Почему `/ws` и `/new` не падают: команды обрабатываются локально, до `ensureAgent`
(`src/server/router.ts:170-183`).

Дополнительный дефект: handle из `createNewSession` не диспозится никогда — `router.dispose()`
(`src/server/router.ts:394-399`) закрывает только записи `chatToAgent`, то есть утечка живых агентов.

### План правки (вариант B)
1. `src/server/router.ts`, интерфейс `Agents` (строки 34-37): добавить необязательный метод
   ```typescript
   get?(sessionId: string): AgentHandle["agent"] | undefined;
   ```
2. `src/server/router.ts`, `createNewSession`:
   - перед `ctx.agents.create(...)` снять старый handle из кэша и закрыть его
     (`chatToAgent.get(chatId)` → если есть, `chatToAgent.delete(chatId)` + `await stale.dispose()` с логом ошибки);
   - после `const actualSessionId = handle.agent.session.id;` (`src/server/router.ts:444`) добавить
     `chatToAgent.set(chatId, handle);`.
3. `src/server/router.ts`, `ensureAgent` (строки 142-148): перед `resume` проверить живого агента
   ```typescript
   const live = sessionId ? ctx.agents.get?.(sessionId) : undefined;
   const handle: AgentHandle = live
     ? { agent: live, dispose: async () => {} }
     : sessionId
       ? await ctx.agents.resume({ resumeSessionId: sessionId })
       : await ctx.agents.create({ ... });
   ```
   Заглушка `dispose` намеренная: агент чужой (создан не этим вызовом), закрывать его нельзя.
4. После правок: `npx tsc --noEmit && npm test && node build.js`, затем рестарт DSH.

### Критерий приёмки
- В логе идёт `ensureAgent: chatId=...` и далее `Resumed session ...`/`Created session ...` без
  `ensureAgent failed` и без `SessionAlreadyOwnedError`.
- Сценарий: `/new` → обычный текст → бот отвечает моделью (не «Failed to process your message»).
- Второй сценарий: рестарт DSH → обычный текст в тот же чат → ответ модели (проверяет fallback через `ctx.agents.get`).

### Решение
3 правки:

1. **`src/server/index.ts:276`** — в тип `ctx` добавлено поле:
   ```typescript
   get?(key: string): unknown;
   ```
2. **`src/server/index.ts:381`** — при создании роутера прокинут сервис:
   ```typescript
   sessionPersistence: ctx.get?.("sessionPersistence") as any,
   ```
3. **`src/server/router.ts:105,342`** — в тип `RouterContext.logger` добавлен `warn`, и в `/list` добавлена проверка отсутствия сервиса с логами предупреждения.

### Проверка
- `npx tsc --noEmit` — ✅ прошёл (exit code 0)
- `npm test` — ✅ 91/91 тестов прошли (exit code 0)
- `node build.js` — ✅ сборка прошла успешно

---

## 3. P1 — `/list` и `/status` всегда показывают пустые данные

**Статус:** ✅ исправлено

### Проблема
В боевом режиме `/list` всегда отвечает «Сессий не найдено», `/status` всегда показывает «Событий: 0».

### Причина
`sessionPersistence` не передаётся в роутер: `src/server/index.ts:375-380` передаёт только
`agents`, `logger`, `cwd`, `workspaceRegistry`. При этом роутер его читает:
`src/server/router.ts:335` (`ctx.sessionPersistence?.list`) и `src/server/router.ts:284`, `:301`
(`fetchSessionStat(sessionId, ctx.sessionPersistence)`). Значит `undefined` → пустые ответы.
Тесты зелёные, потому что сервис замокан: `test/list.test.ts:98,137,183,218,253`,
`test/status.test.ts:196-197`.

### План правки
1. В `src/server/index.ts` при создании роутера прокинуть сервис:
   `sessionPersistence: ctx.get?.("sessionPersistence")` — сервис необязательный, поэтому через `ctx.get`,
   не через `ctx.<name>` (в харнессе доступен как `ctx.get('sessionPersistence')`,
   `/home/dmitry/deepseek-harness/packages/api/session-controller/src/index.ts:445`).
2. В типе `ctx` (`src/server/index.ts`, блок около строки 275) объявить `get?(key: string): unknown`.
3. Опционально: в `src/server/router.ts` залогировать один раз отсутствие сервиса, чтобы пустые
   ответы не выглядели нормой.

### Критерий приёмки
- `/list` в чате с существующей сессией перечисляет сессии воркспейса.
- `/status` показывает ненулевой `eventCount` для сессии, где уже были ходы.

### Решение
_(заполняется после правки)_

---

## 4. P1 — ответ inline-кнопок не доходит в чат

**Статус:** ❌ открыто

### Проблема
Нажатие `⏹ Stop` / `🆕 New` молча «проходит»: в чат не приходит «Генерация остановлена» / «Кнопка устарела».

### Причина
`src/server/webhook.ts:127` вызывает `await router.handleCallback(chatId, cb.data)` и **отбрасывает**
возвращаемый `{ text }`; дальше выполняется только `answerCallbackQuery(cb.id)` без текста.
Тексты формируются в `src/server/router.ts:374-386` и теряются.

### План правки
1. `src/server/webhook.ts`: сохранить результат и отправить текст:
   ```typescript
   const result = await router.handleCallback(chatId, cb.data);
   if (result?.text) await bot.sendText(chatId, result.text);
   ```
2. `answerCallbackQuery(cb.id)` оставить как индикатор «нажатие принято».

### Критерий приёмки
- Нажатие `⏹ Stop` при активной генерации печатает «Генерация остановлена» в чат.
- Нажатие устаревшей кнопки печатает «Кнопка устарела».

### Решение
_(заполняется после правки)_

---

## 5. P2 — `/ws` помечает `*` все воркспейсы вместо текущего

**Статус:** ❌ открыто

### Проблема
В списке `/ws` звёздочкой отмечены все воркспейсы, а не выбранный для чата.

### Причина
`src/server/commands.ts:121` считает маркер как `const marker = ws.title ? "*" : "";`, а `title` всегда
непустой (fallback = путь, `src/server/workspaces.ts:69`). Сравнения с текущим `workspacePath` чата нет.

### План правки
1. Передавать в `buildInlineKeyboard`/обработчик `/ws` текущий `workspacePath` из `loadChatState(chatId)`.
2. Маркер ставить по сравнению `ws.path === currentWorkspacePath`.
3. Обновить `test/commands.test.ts` под новую сигнатуру.

### Критерий приёмки
- После `/ws 2` повторный `/ws` показывает `*` ровно у одного воркспейса.

### Решение
_(заполняется после правки)_

---

## 6. P2 — протокол кнопок `ws:N` заявлен, но не реализован

**Статус:** ❌ открыто

### Проблема
`AGENTS.md:148` обещает протокол `act:stop`, `act:new`, `ws:3`, но кнопок выбора воркспейса нет.

### Причина
Строки `ws:` нет ни в `src/`, ни в `lib/`; клавиатура `/ws` содержит только `🆕 New Chat`
(`src/server/commands.ts:112,128`); `handleCallback` (`src/server/router.ts`) знает только `act:stop` и `act:new`.

### План правки
1. В `src/server/commands.ts` для `/ws` собрать по кнопке на воркспейс с `callback_data: \`ws:${index}\``.
2. В `handleCallback` добавить ветку `ws:` → `resolveWorkspace` + `saveChatState(chatId, { workspacePath })`
   + ответ со списком/подтверждением.
3. Тест: `ws:1` переключает воркспейс, неизвестный `ws:99` → «Кнопка устарела».

### Критерий приёмки
- `/ws` показывает кнопки воркспейсов; нажатие переключает воркспейс чата.

### Решение
_(заполняется после правки)_

---

## 7. P2 — фото/документы теряются, `media.ts` мёртвый код

**Статус:** ❌ открыто

### Проблема
Если отправить боту фото или документ, бот молчит.

### Причина
`src/server/webhook.ts:155-161` извлекает `photo`/`document` и передаёт их в `routeMessage`,
но `src/server/router.ts:165` делает `if (!text) return;` — сообщение без текста отбрасывается.
`src/server/media.ts` (216 строк) никем не импортируется.

### План правки
Выбрать одно:
- **подключить**: в `routeMessage` при отсутствии текста, но наличии `photo`/`document`, скачать файл
  через `media.ts`, сохранить в temp и отправить агенту как текст-ссылку на путь;
- **удалить**: убрать `src/server/media.ts` и `test/media.test.ts`, а в `webhook.ts` отвечать
  «Вложения пока не поддерживаются».

### Критерий приёмки
- Поведение описано в `README.md` и совпадает с кодом; мёртвых модулей нет.

### Решение
_(заполняется после правки)_

---

## 8. P3 — латентный краш на `ctx.credentials`

**Статус:** ❌ открыто

### Проблема
`src/server/index.ts:364` обращается к `ctx.credentials?.resolve("telegram:botToken")`, но `credentials`
нет в `inject` (`src/server/index.ts:13`). Сейчас не падает только потому, что `settings.botToken` заполнен
и ветка короткозамкнута.

### Причина
Cordis запрещает читать незаинжекченное свойство. Такая ошибка уже была в логе:
`~/.dsh/logs/startup-2026-11-11T05-53-19.916Z-1176069b-bb98-47e2-a0d9-47c72aa5e0a6.log:56`
— `Error: cannot get property "credentials" without inject at new apply (.../src/server/index.ts:196:18)`.

### План правки
Заменить на `ctx.get?.("credentials")?.resolve("telegram:botToken")` (сервис необязательный) либо добавить
`"credentials"` в `inject`.

### Критерий приёмки
- Пустой `botToken` в настройках → плагин стартует и пишет внятную ошибку, а не падает на чтении свойства.

### Решение
_(заполняется после правки)_

---

## 9. P3 — документация рассинхронизирована с кодом

**Статус:** ❌ открыто

### Проблема
`STATUS.md` (10.11) утверждает «5 suites failed, 24 failed / 18 passed» — при фактических 91/91.
`AGENTS.md:4` говорит «на паузе после подзадачи 5», а `AGENTS.md:129` — «ВСЕ ПОДЗАДАЧИ ВЫПОЛНЕНЫ».

### План правки
1. Переписать `STATUS.md` по факту: 91/91 тестов, `tsc` чистый, сборка есть, открытые пункты — ссылки на разделы этого файла.
2. Синхронизировать шапку `AGENTS.md` с §5.
3. Закоммитить незакоммиченное: `src/server/index.ts`, `src/server/router.ts`, `lib/**`, `FIXES.md`
   (HEAD `63c81d7`).

### Критерий приёмки
- `git status` чистый, `STATUS.md` не противоречит выводу `npm test`.

### Решение
_(заполняется после правки)_

---

## Порядок работ

1. Пункт 2 — сообщения вообще не работают, это блокер.
2. Пункт 3 — `/list` и `/status` бесполезны без persistence.
3. Пункт 4 — кнопки молчат.
4. Пункты 5 и 6 вместе (один файл `commands.ts`, один протокол).
5. Пункт 7 — решить судьбу `media.ts`.
6. Пункт 8 — убрать латентный краш.
7. Пункт 9 — доки и коммит.

---

## Что НЕ трогать

- `src/server/state.ts` — реализован и протестирован (debounce 500 ms, атомарная запись).
- `src/server/workspaces.ts` — работает.
- `src/server/telegram.ts` и `src/server/webhook.ts` — только точечно (пункт 4).
