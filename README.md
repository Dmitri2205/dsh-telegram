# dsh-telegram

DeepSeek Harness plugin: connect your agent to a Telegram bot.

## Installation

```bash
# Install via plugin manager
plugin_manager install_bundle /path/to/dsh-telegram
```

## Configuration

Add to your `cordis.patch.yml`:

```yaml
- insert:
    - id: telegram-bot
      name: '@local/dsh-telegram'
      config:
        botToken: 'YOUR_BOT_TOKEN'
        mode: webhook          # or 'polling' (V2)
        allowedChatIds: []     # empty = all, or whitelist [123456, ...]
        webhookSecret: ''      # optional, defaults to botToken
        maxFileSize: 10485760  # 10MB
```

## Usage

1. Set up a Telegram bot via @BotFather
2. Get the bot token
3. Set `TELEGRAM_BOT_TOKEN` environment variable or configure in `cordis.patch.yml`
4. Restart DSH

### Commands

- `/start` — Start a new conversation
- `/new` — Start a fresh session
- `/help` — Show available commands
- `/list` — List active sessions

## Webhook Setup

For webhook mode, configure your bot's webhook URL:

```
POST https://api.telegram.org/bot<TOKEN>/setWebhook
{
  "url": "https://your-domain/telegram/webhook",
  "secret_token": "your-secret"
}
```
