# План: Telegram-плагин для DSH с тестами

## Цель
Создать плагин `dsh-telegram` для подключения DSH-агента к Telegram-боту, покрыть код тестами до интеграции.

## Успех
- Плагин устанавливается через `plugin_manager install_bundle`
- Бот принимает сообщения от пользователей, передаёт их агенту, возвращает ответ
- Покрытие тестами: маршруты webhook, маршрутизация сообщений, маппинг чатов, обработка медиа, команды
- Все тесты проходят: `node --test test/*.test.ts`

---

## Фаза 1: Структура проекта

```
dsh-telegram/
├── package.json              # @local/dsh-telegram, dsh.bundle.patch
├── cordis.patch.yml          # Вставка в bundle с config (botToken, allowedChatIds, mode)
├── README.md
├── locale/
│   └── en.json               # meta.title, meta.description
├── icon.svg
├── tsconfig.json
├── src/
│   └── server/
│       ├── index.ts          # Host plugin: apply(ctx, config)
│       ├── telegram.ts       # Telegram Bot API клиент (send, receive updates)
│       ├── webhook.ts        # Webhook handler (webServer.register)
│       ├── router.ts         # ChatId → SessionId маппинг + маршрутизация
│       ├── media.ts          # Telegram media → DSH attachments
│       └── commands.ts       # /start, /new, /help обработка
├── test/
│   ├── helper.ts             # Фейковый DSH контекст + утилиты для тестов
│   ├── telegram.test.ts      # Telegram Bot API клиент
│   ├── webhook.test.ts       # Webhook endpoint (подпись, парсинг update)
│   ├── router.test.ts        # ChatId ↔ SessionId маппинг, создание/возобновление агентов
│   ├── media.test.ts         # Конвертация Telegram photos/files → DSH attachments
│   └── commands.test.ts      # Обработка /start, /new, /help
└── lib/                      # Скомпилированный код
```

---

## Фаза 2: Тесты (пишем ДО кода)

### 2.1 Фейковый контекст (`test/helper.ts`)
- `createFakeContext()` — возвращает объект, имитирующий DSH `ctx`:
  - `webServer.register(route)` — собирает маршруты в Map
  - `agents` — mock с `create()`, `resume()`, `list()`, `register()`
  - `attachments` — mock с `saveImages()`, `saveFile()`
  - `credentials` — mock с `resolve()` для bot token
  - `storage` — mock с in-memory storage для chatId↔sessionId маппинга
  - `logger` — mock с debug/info/warn/error
- `callRoute(route, options)` — утилита для вызова маршрута с фейковым req/res

### 2.2 `test/telegram.test.ts` — Telegram Bot API клиент
- `sendText(chatId, text)` — POST к `/sendMessage`, проверяет URL и body
- `sendPhoto(chatId, photoUrl)` — POST к `/sendPhoto`
- `setWebhook(url)` — POST к `/setWebhook`
- `deleteWebhook()` — POST к `/deleteWebhook`
- `getMe()` — POST к `/getMe`, проверяет возвращение bot info
- Ошибки Telegram API — прокидываются с текстом ответа
- Retry на 429/500 — реализация retry с exponential backoff

### 2.3 `test/webhook.test.ts` — Webhook handler
- `POST /telegram/webhook` — принимает update от Telegram
- Проверка `X-Telegram-Bot-Api-Secret-Token` — отклоняет неверный токен
- Парсинг `message.text` — извлекает текст сообщения
- Парсинг `message.photo` — извлекает фото (размер largest)
- Парсинг `message.document` — извлекает файл
- Поддержка `callback_query` — игнорируется или логируется
- JSON-валидация — отклоняет не-JSON body с 400
- Webhook подтверждение — отвечает 200 OK быстро (не блокируя)

### 2.4 `test/router.test.ts` — ChatId → SessionId маппинг
- `routeMessage(chatId, message)` — создаёт нового агента если chatId новый
- Кэширование chatId→sessionId — повторные сообщения того же чата идут тому же агенту
- `newSession(chatId)` — сбрасывает сессию (для /new)
- `listSessions()` — возвращает список активных сессий
- Обработка ошибок создания агента — логирует, не падает
- Параллельные сообщения — очередь, не дублируют агентов

### 2.5 `test/media.test.ts` — Telegram media → DSH attachments
- `downloadAndSaveImage(telegramFileUrl)` — скачивает, валидирует, сохраняет через `attachments.saveImages()`
- `downloadAndSaveFile(telegramDocUrl)` — скачивает, сохраняет через `attachments.saveFile()`
- Валидация размера — отклоняет файлы > лимита (configurable, default 10MB)
- Валидация типа — только image/png, image/jpeg, image/webp, image/gif для фото
- Ошибки скачивания — логируются, не падают

### 2.6 `test/commands.test.ts` — Telegram команды
- `/start` — отвечает приветствием, создаёт сессию
- `/new` — создаёт новую сессию для чата
- `/help` — шлёт список команд
- `/list` — шлёт список активных сессий
- Неизвестная команда — отвечает "Unknown command"
- Команды в обычном сообщении — игнорируются (не команды)

---

## Фаза 3: Реализация (passing the tests)

### 3.1 `src/server/telegram.ts` — Telegram Bot API клиент
- Конструктор `(token: string)` — хранит token
- `request<T>(method, body)` — универсальный метод: `POST https://api.telegram.org/bot${token}/${method}`
- `sendText(chatId, text)` → `{ok: boolean, result?: Message}`
- `sendPhoto(chatId, photo, caption?)` → `{ok: boolean, result?: Message}`
- `setWebhook(url, secret?)` → `{ok: boolean}`
- `deleteWebhook()` → `{ok: boolean}`
- `getMe()` → `{ok: boolean, result?: User}`
- Retry logic: 429 → wait, 500 → retry 3x

### 3.2 `src/server/webhook.ts` — Webhook handler
- `createWebhookHandler(bot, config)` → Express-style handler
- `webServer.register({ kind: 'exact', path: '/telegram/webhook', handler })`
- Secret token проверка: `req.headers['x-telegram-bot-api-secret-token'] === config.webhookSecret`
- Парсинг JSON body → Telegram Update
- Dispatch к `router.routeMessage()` асинхронно
- Ответ: 200 OK (быстро, не ждём ответа агента)

### 3.3 `src/server/router.ts` — Маршрутизация
- `createRouter(bot, ctx)` → Router instance
- `chatSessions: Map<ChatId, SessionId>` — маппинг
- `routeMessage(chatId, message)`:
  1. Проверить `chatSessions.get(chatId)`
  2. Если нет — `ctx.agents.create()` с опциями сессии
  3. Сохранить маппинг
  4. Передать сообщение агенту (`agent.submit()` или аналог)
  5. Получить ответ → `bot.sendText(chatId, text)`
- `newSession(chatId)` — удалить из `chatSessions`, создать нового
- `listSessions()` — вернуть список

### 3.4 `src/server/media.ts` — Работа с медиа
- `downloadAndSaveImage(url, ctx)` — fetch → validate → `ctx.attachments.saveImages()`
- `downloadAndSaveFile(url, ctx)` — fetch → `ctx.attachments.saveFile()`
- Config: `maxFileSize` (default 10MB)

### 3.5 `src/server/commands.ts` — Обработка команд
- `parseCommand(text)` → `{ command: string, args: string[] } | null`
- `/start` → `router.newSession(chatId)` + приветствие
- `/new` → `router.newSession(chatId)` + подтверждение
- `/help` → `bot.sendText(chatId, helpText)`
- `/list` → `bot.sendText(chatId, sessionsList)`

### 3.6 `src/server/index.ts` — Точка входа (apply)
```typescript
export function apply(ctx, config) {
  const token = ctx.credentials?.resolve('telegram:bot-token') || config.botToken;
  const bot = new TelegramBot(token);
  const router = createRouter(bot, ctx);
  const webhookHandler = createWebhookHandler(bot, {
    webhookSecret: config.webhookSecret || config.botToken,
    allowedChatIds: config.allowedChatIds || [],
  });
  ctx.webServer.register({ kind: 'exact', path: '/telegram/webhook', handler: webhookHandler });
  // Логирование старта
  return () => { /* dispose */ };
}
```

---

## Фаза 4: Конфигурация и установка

### 4.1 `package.json`
```json
{
  "name": "@local/dsh-telegram",
  "version": "0.1.0",
  "type": "module",
  "main": "./lib/server/index.js",
  "types": "./lib/server/index.d.ts",
  "exports": {
    ".": { "types": "./lib/server/index.d.ts", "default": "./lib/server/index.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "cordis.patch.yml" }
  },
  "scripts": {
    "build": "tsc",
    "test": "node --test test/*.test.ts",
    "prepublishOnly": "npm run build"
  },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.1" },
  "devDependencies": { "@types/node": "^20.0.0", "typescript": "^5.3.0" }
}
```

### 4.2 `cordis.patch.yml`
```yaml
- insert:
    - id: telegram-bot
      name: '@local/dsh-telegram'
      config:
        botToken: '${TELEGRAM_BOT_TOKEN}'
        mode: webhook  # или 'polling' для V2
        allowedChatIds: []  # пустой = всем, иначе whitelist
        webhookSecret: ''
```

---

## Фаза 5: Edge cases и failure modes

| Сценарий | Поведение |
|----------|-----------|
| Telegram API down | Retry 3x с exponential backoff, лог ошибки |
| Agent не создался | Лог ошибки, ответ в Telegram: "Ошибка создания сессии" |
| Agent timeout | Ответ: "Агент не ответил за 60с", не удалять сессию |
| Пользователь не из whitelist | Ответ: "Доступ запрещён" |
| Файл > 10MB | Ответ: "Файл слишком большой (макс. 10MB)" |
| Неподдерживаемый тип медиа | Ответ: "Этот тип файлов не поддерживается" |
| Webhook secret mismatch | Ответ 403, лог |
| Двойной webhook callback | Debounce по update_id |
| DSH restart | Сессии восстанавливаются из storage при старте |

---

## Порядок реализации

1. **Создать структуру** — package.json, tsconfig, cordis.patch.yml, locale, icon
2. **Написать тесты** — все 5 файлов тестов (telegram, webhook, router, media, commands)
3. **Реализовать** — telegram.ts → webhook.ts → router.ts → media.ts → commands.ts → index.ts
4. **Собрать** — `npm run build`
5. **Прогнать тесты** — `npm test` — все должны пройти
6. **Установить** — `plugin_manager install_bundle` (абсолютный путь к директории)
