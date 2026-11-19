# dsh-telegram

Telegram-бот, который превращает чат в Telegram в канал к агенту DeepSeek Harness:
сообщение из чата → ход агента → ответ агента обратно в чат.

```
Telegram ──POST──▶ /telegram/webhook ──▶ router ──▶ agent.followup()
                        ▲                              │
                        └──── sendText(ответ) ◀── session/event (assistant/message)
```

## Установка в профиль

1. Пакет добавлен в профиль как `file:`-зависимость и в список бандлов
   (`~/.dsh/profiles/web/package.json` → `dependencies` + `dsh.profile.bundles`).
2. `cd ~/.dsh/profiles/web && pnpm install --force`
   (`--force` обязателен: профиль держит снимок пакета с hardlink'ами, новые
   файлы в снимок сами не попадают).
3. Перезапуск DSH.

Проверка загрузки: `journalctl --user -u dsh-web | grep -E "did not activate|failed to import"`.

## Настройка

Всё настраивается в UI: **Settings → Telegram Bot** (слот `settings.section`).

| Поле | Смысл |
| --- | --- |
| Bot Token | токен от @BotFather |
| Allowed Chat IDs | список числовых chat id; пусто = разрешены все чаты |
| Webhook URL | публичный `https://`-адрес DSH, путь задаёт точку приёма (по умолчанию `/telegram/webhook`) |

Значения лежат в `~/.dsh/telegram-settings.json` (права `0600`). Если файла нет —
используются поля `Config` из `cordis.patch.yml`, затем `ctx.credentials.resolve('telegram:botToken')`.

Важно: `${TELEGRAM_BOT_TOKEN}` в `cordis.patch.yml` **не** разворачивается —
загрузчик DSH не интерполирует окружение. Токен задаётся либо через UI, либо
литералом в конфиге (последнее хуже — секрет попадает в git).

### Прокси

`node:https` не читает `HTTPS_PROXY` (это делает только `undici`/`fetch`), поэтому
плагин сам поднимает CONNECT-туннель: `src/server/proxy.ts`, адрес берётся из
`config.proxy` или `HTTPS_PROXY` / `https_proxy` / `HTTP_PROXY` / `http_proxy` /
`ALL_PROXY`. Без прокси Telegram API из процесса DSH недоступен, если сеть наружу
закрыта.

## HTTP-эндпоинты

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/telegram/api/settings` | текущие настройки + вычисленный webhook URL + `webhookStatus` |
| POST | `/telegram/api/settings` | сохранить и сразу перерегистрировать вебхук |
| POST | `/telegram/webhook` | приём апдейтов Telegram |

Роут настроек регистрируется с `kind: "exact"` и **до** проверки токена, поэтому
страница настроек работает даже с пустым токеном.

`POST /telegram/webhook` требует заголовок `X-Telegram-Bot-Api-Secret-Token`,
равный `sha256("dsh-telegram:" + botToken)`. Сырой токен использовать нельзя:
Telegram запрещает символ `:` в `secret_token`.

## Команды

Обрабатываются локально в `src/server/router.ts` (в агент не уходят):

| Команда | Описание |
| --- | --- |
| `/start` | Приветствие + новая сессия |
| `/ws` | Список доступных воркспейсов |
| `/ws N` | Выбрать воркспейс по номеру из списка |
| `/ws <путь>` | Выбрать воркспейс по абсолютному пути |
| `/new` | Новая сессия в выбранном воркспейсе |
| `/stop` / `/cancel` | Остановить генерацию агента |
| `/status` | Статус текущего агента (сессия, воркспейс, события, активность) |
| `/list` | Живые (не архивные) сессии воркспейса: заголовок и дата (новые сверху) |
| `/help` | Справка по всем командам |

## Хранение состояния

Состояние чатов сохраняется на диске в `~/.dsh/telegram-chats.json`. Формат:

```json
{
  "chats": {
    "<chatId>": {
      "chatId": 123456,
      "workspacePath": "/home/user/project",
      "sessionId": "telegram-123456-uuid-here",
      "lastStatus": "idle",
      "updatedAt": "2025-01-15T10:30:00.000Z"
    }
  }
}
```

Запись ведётся с debounce (500 мс) и атомарно (tmp + rename). При отсутствии файла
или ошибке чтения возвращается дефолтное состояние: `workspacePath` и `sessionId`
не установлены.

## Диагностика

### `/list` отвечает «Сессий не найдено»

1. Проверь, что воркспейс выбран: `~/.dsh/telegram-chats.json` → `chats.<chatId>.workspacePath`.
2. `/list` показывает сессии, **прикреплённые к воркспейсу** в реестре, кроме помеченных в архиве
   (`~/.dsh/storages/workspace.json` → `global.archivedSessionIds`). Если список пуст — проверь,
   не в архиве ли нужные сессии (кнопка «Архив» в GUI).
3. Убедись, что установленный бандл собран из текущего `src/`: профиль держит **хардлинк** на `lib/`:
   ```bash
   ls -li lib/server/index.js \
     ~/.dsh/profiles/web/node_modules/@local/dsh-telegram/lib/server/index.js
   ```
   одинаковый inode = одна и та же сборка.
4. После пересборки **перезапусти DSH**: плагин живёт в памяти процесса, старый код продолжает работать.

Почему сервис может быть `undefined`, хотя всё установлено, — `AGENTS.md`, раздел 7.

### Как читаются сессии

`router.listWorkspaceSessions` берёт `workspace.sessionIds` из `ctx.workspaceRegistry`
(по `path === workspacePath`), вычитает `archivedSessionIds` и показывает остаток. `createdAt`
подтягивается из `ctx.sessionPersistence.list()` (снапшоты `{header:{id,cwd,createdAt}}`), сортировка —
новые сверху, лимит 10 + «…и ещё N». Id сессии и число событий в вывод не попадают.

Заголовок резолвится так: живая ячейка `sessionProjections.cachedSnapshot(ctx.sessions.get(id), ["title"])`
→ durable-кэш `sessionProjectionCache.cachedSnapshot(header, ["title"])` → «Без названия».
Все сервисы (`workspaceRegistry`, `sessionPersistence`, `sessions`, `sessionProjections`,
`sessionProjectionCache`) необязательные и резолвятся **лениво при каждом обращении**
(`src/server/index.ts`), потому что монтируются асинхронно и могут стать активными позже нашего
`apply()`. Если persistence недоступен, список всё равно строится по id из реестра (время «—»).

### Сборка и тесты без `npx`

В этом окружении `npx`/`npm` падают с EROFS (npm-кэш только для чтения) — используй бинарники харнесса:

```bash
/home/dmitry/deepseek-harness/node_modules/.bin/tsc -p tsconfig.json
/home/dmitry/deepseek-harness/node_modules/.bin/tsx --test test/*.test.ts
```

## Публичный HTTPS

Telegram принимает только `https`-вебхук с валидным сертификатом. Типовая схема:
NPM (nginx-proxy-manager) терминирует TLS и проксирует на DSH. При этом:

- DSH должен слушать не loopback, а адрес, доступный прокси
  (`--host 192.168.0.171`; wildcard `0.0.0.0` харнесс запрещает);
- в NPM `Scheme` — `http`, порт — порт DSH;
- если домен за Cloudflare, origin-сертификат должен покрывать имя (wildcard
  `*.example.com` не покрывает `a.b.example.com`).

## Структура

| Файл | Роль |
| --- | --- |
| `src/server/index.ts` | плагин: конфиг, settings-API, регистрация роутов, setWebhook, подписка на `session/event` |
| `src/server/router.ts` | chatId → агент, `followup`/`whenIdle`, сбор текста ответа, команды, callback-кнопки |
| `src/server/webhook.ts` | валидация секрета, разбор апдейта, whitelist |
| `src/server/telegram.ts` | Telegram Bot API (sendText, setWebhook, getFile…), ретраи |
| `src/server/proxy.ts` | CONNECT-туннель через HTTP-прокси |
| `src/server/commands.ts` | парсинг и обработка `/…` команд |
| `src/server/state.ts` | персистентное состояние чатов (`~/.dsh/telegram-chats.json`) с debounce-записью |
| `src/server/workspaces.ts` | список и разрешение воркспейсов из registry DSH |
| `src/server/media.ts` | обработка фото и документов (скачивание + отправка) |
| `src/client/index.tsx` | секция настроек в UI |
