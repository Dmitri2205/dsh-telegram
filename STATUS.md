# dsh-telegram — текущее состояние и следующие шаги

Дата: 2026-11-10

Утверждённый план проекта лежит в [PLAN.md](./PLAN.md).

## Состояние проекта (кратко)

Создано в `/home/dmitry/dsh_plugins/dsh-telegram/`:

- Конфигурация: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `jest.config.ts`, `cordis.patch.yml`, `locale/en.json`, `icon.svg`, `README.md`
- Код `src/server/`: `telegram.ts`, `webhook.ts`, `router.ts`, `media.ts`, `commands.ts`, `index.ts`
- Тесты `test/`: `helper.ts`, `telegram.test.ts`, `webhook.test.ts`, `router.test.ts`, `media.test.ts`, `commands.test.ts`

Проверка: `npx tsc --noEmit` — 0 ошибок. `npx jest` — 5 suites failed, 24 failed / 18 passed / 42 total.

## Причины падений тестов

1. `telegram.test.ts` и `media.test.ts` — `jest.spyOn(node:http, "request"/"get")` невозможен (`Cannot redefine property`), плюс `httpRequests.clear is not a function`. Тесты мокают `node:http`, что Jest не умеет.
2. `webhook.test.ts` (все 9) — `route.handler is not a function`: сигнатура `createWebhookHandler` не совпадает с тем, как её вызывают тесты/`index.ts`.
3. `router.test.ts` — «caches chatId → agent»: `agents.create` вызван 2 раза вместо 1 (гонка при параллельных сообщениях), а `listSessions()` читает только `persistedSessions`, который всегда пуст (`loadPersistedSessions` возвращает `{}`), поэтому сессии, созданные в рантайме, не видны.
4. `commands.test.ts` — `/list` обрезает `sessionId` до 8 символов (`.slice(0,8)`), тест ждёт полный `session-1`.
5. Несоответствие раннеров: `package.json` объявляет `node --test`, а тесты написаны на Jest (`describe/it`).

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
   - `/list` — не обрезать `sessionId` (или синхронизировать тест с форматом).
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
