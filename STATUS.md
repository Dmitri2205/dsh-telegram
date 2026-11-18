# dsh-telegram — текущее состояние и следующие шаги

Дата: 2026-11-10 | Боевой сценарий #2 проверен: 2026-11-16 | Синхронизация правки: 2026-11-16

Утверждённый план проекта лежит в [PLAN.md](./PLAN.md).

## Состояние проекта (кратко)

Создано в `/home/dmitry/dsh_plugins/dsh-telegram/`:

- Конфигурация: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `cordis.patch.yml`, `locale/en.json`, `icon.svg`, `README.md`
- Код `src/server/`: `telegram.ts`, `webhook.ts`, `router.ts`, `media.ts`, `commands.ts`, `index.ts`, `state.ts`, `proxy.ts`
- Тесты `test/`: `helper.ts`, `telegram.test.ts`, `webhook.test.ts`, `router.test.ts`, `media.test.ts`, `commands.test.ts`
- Тест-раннер: `tsx --test test/**/*.test.ts`

Проверка: `npx tsc --noEmit` — 0 ошибок. `tsx --test` — 91/91 тестов прошли (0 failed), 0 suites. `node build.js` — сборка успешна.

## Причины падений тестов (рантайм)

Тесты проходят (91/91), но при боевом запуске выявлены дефекты:

Закрытые пункты: 1, 3, 10 ✅ (см. [FIXES.md](./FIXES.md)).  
Открытые пункты: 2, 4, 5, 6, 7, 8, 9 ❌ (см. [FIXES.md](./FIXES.md)).

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
