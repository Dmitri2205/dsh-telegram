# dsh-telegram — текущее состояние и следующие шаги

Дата: 2026-11-10 | Боевой сценарий #2 проверен: 2026-11-16 | Синхронизация правки: 2026-11-16
| `/list` починен и проверен в бою: 2026-11-19
| `/list` — только живые сессии, заголовок + дата, без id: 2026-11-19

Утверждённый план проекта лежит в [PLAN.md](./PLAN.md).
Правила для агентов (в т.ч. грабли Cordis и сборка без `npx`) — в [AGENTS.md](./AGENTS.md), разделы 7–8.

## Состояние проекта (кратко)

Создано в `/home/dmitry/dsh_plugins/dsh-telegram/`:

- Конфигурация: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `cordis.patch.yml`, `locale/en.json`, `icon.svg`, `README.md`
- Код `src/server/`: `telegram.ts`, `webhook.ts`, `router.ts`, `media.ts`, `commands.ts`, `index.ts`, `state.ts`, `proxy.ts`
- Тесты `test/`: `helper.ts`, `telegram.test.ts`, `webhook.test.ts`, `router.test.ts`, `media.test.ts`, `commands.test.ts`, `list.test.ts`, `new.test.ts`, `stop.test.ts`, `status.test.ts`, `state.test.ts`, `workspaces.test.ts`
- Тест-раннер: `/home/dmitry/deepseek-harness/node_modules/.bin/tsx --test test/*.test.ts`

Проверка (19.11.2026): `tsc -p tsconfig.json` — эмит в `lib/`, остались только средовые ошибки `TS2591`/`TS7006`
(нет `@types/node`). `tsx --test` — **112/112** (0 failed). `npx`/`npm` в этом окружении падают с EROFS —
используй бинарники харнесса (см. `AGENTS.md`, раздел 8).

## Причины падений тестов (рантайм)

Тесты проходят (112/112), но при боевом запуске выявлены дефекты:

Закрытые пункты: 1, 3, 10, 11 ✅ (см. [FIXES.md](./FIXES.md)).  
Открытые пункты: 2, 4, 5, 6, 7, 8, 9 ❌ (см. [FIXES.md](./FIXES.md)).

## 19.11.2026 — что было сделано

- `/list` и `/status` снова видят persistence. Причин было две: неверный ключ сервиса
  (`session-persistence-jsonl` вместо `sessionPersistence`) и чтение сервиса один раз в `apply()`
  до того, как асинхронный бэкенд станет активным. Вторая причина и была основной.
- Решение: ленивый `Proxy` в `src/server/index.ts:376-397` резолвит `sessionPersistence` и
  `agentDefaultModel` при каждом обращении. Ошибка `list()` теперь пишется в `logger.warn`.
- Живая проверка: маркеры в файл дали `rawCount: 217`, `filteredCount: 84`; `/list` в Telegram
  вернул 84 сессии. Маркеры после проверки удалены.
- `/list` переделан по запросу: вывод — только «живые» (не архивные) сессии воркспейса,
  без id и числа событий, строка `<▶|  >dd.MM HH:MM · <заголовок>`, новые сверху, лимит 10.
  Источник — `workspace.sessionIds` минус `global.archivedSessionIds` (реестр `workspace.json`),
  а не файлы на диске и не память процесса (этот вариант давал пустой список после рестарта).
  Для этого воркспейса 27 привязанных − 8 архивных = 19 живых. Сборка готова, нужен рестарт.
- Тесты: `test/list.test.ts` — 22 теста (реестр/архив, сортировка ms и ISO, маркеры, точный
  формат без id, цепочка заголовков live projection → durable cache → flat → «Без названия»,
  падающие сервисы, отсутствие persistence, лимит и «…и ещё N»); всего 112/112.
- Подробный разбор и грабли — `FIXES.md` пункт 11 и `AGENTS.md` раздел 7.

## План следующих шагов

1. Выбрать и унифицировать тест-раннер. Рекомендуется `node:test` + `node:assert/strict` (как в `dsh-fetch-modifier`): удалить `jest.config.ts`, зависимости `jest/ts-jest/@types/jest`, переписать тесты на `test()`, обновить `scripts.test`.

2. Сделать HTTP-слой инъектируемым вместо мокинга `node:http`:
   - `TelegramBot` — принимать transport/`request` в конструкторе (по умолчанию `http.request`).
   - `media.ts` — принимать `httpGet`/`fetch` параметром.
   - Тесты передают фейковый transport, а не патчат модуль.

3. Исправить `router.ts`:
   - Добавить `Map<chatId, Promise<AgentHandle>>` (in-flight) — устранить гонку дублирующего `agents.create`.
   - `listSessions()` объединять in-memory `chatToAgent` + persisted-маппинг; вести `Map<chatId, sessionId>`.
   - `newSession()` — удалять persisted-ключ и in-memory запись (сейчас пишет `""`).
   - Реализовать `loadPersistedSessions` реально (или явно задокументировать, что storage не перечисляем, и хранить индекс ключей).
   - Обрабатывать `photo`/`document` через media-пайплайн перед `submit` (сейчас игнорируются).

4. Исправить `webhook.ts`:
   - Согласовать сигнатуру `createWebhookHandler(...)` с `index.ts` и тестами.
   - Отвечать `200 OK` сразу, `routeMessage` вызывать асинхронно с `.catch(logger.error)`, не `await`.
   - Проверку secret-token делать до тяжёлого парсинга; неизвестные типы update игнорировать.

5. Исправить `commands.ts`:
   - ~~`/list` — не обрезать `sessionId`~~ — снято 19.11.2026: id намеренно не выводится, в списке только заголовок и дата.
   - Убрать дублирующий `case "start": case "start":`.
   - Убедиться, что вызывающий код реально шлёт `text` через `bot.sendText`.

6. Исправить `media.ts`:
   - Убрать заглушку `botTOKEN`; принимать полный URL, собранный как `https://api.telegram.org/file/bot${token}/${file_path}` (через `bot.getFile`).
   - Проверять `content-type`/mime и размер до сохранения; ошибки — в logger.

7. Исправить `index.ts`:
   - `credentials.resolve` в реальном DSH асинхронный — добавить `await`.
   - Прокинуть token/media в router; выбрать `kind: 'exact'` для `/telegram/webhook`.
   - `setWebhook` вызывать только в webhook-режиме при публичном HTTPS-origin.

8. Исправить `telegram.ts`: учитывать `retry_after` из ответа 429; удалить неиспользуемые импорты; разрешить override base URL для тестов.

9. Прогнать `npx tsc --noEmit` и тесты до зелёного, затем `npm run build` и установка через `plugin_manager install_bundle`.
