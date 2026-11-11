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

- `/start` — приветствие + новая сессия
- `/new`, `/newchat`, `/reset` — сбросить сессию чата (агент диспозится)
- `/list` — активные чаты и их sessionId
- `/help` — список команд

Всё остальное уходит агенту.

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
| `src/server/router.ts` | chatId → агент, `followup`/`whenIdle`, сбор текста ответа, команды |
| `src/server/webhook.ts` | валидация секрета, разбор апдейта, whitelist |
| `src/server/telegram.ts` | Telegram Bot API (sendText, setWebhook, getFile…), ретраи |
| `src/server/proxy.ts` | CONNECT-туннель через HTTP-прокси |
| `src/server/commands.ts` | парсинг и обработка `/…` |
| `src/client/index.tsx` | секция настроек в UI |

## Ограничения текущей версии

- фото/файлы из чата в агента не передаются (в `followup` уходит только текст);
- сессии живут в памяти процесса: после рестарта DSH чат стартует новую сессию;
- один чат = одна сессия, выбора воркспейса в боте пока нет;
- нет остановки генерации и статуса агента из чата.

План работ по этим пунктам (выбор воркспейса, `/new` в воркспейсе, `/stop`,
`/status`, `/list` по воркспейсу) — в [`BOT_COMMANDS.md`](./BOT_COMMANDS.md).
