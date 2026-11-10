import { TelegramBot } from "./telegram.js";
import { createWebhookHandler } from "./webhook.js";
import { createRouter } from "./router.js";
/**
 * Apply the Telegram plugin.
 * Sets up the bot, router, and webhook handler, then registers the webhook route.
 * Returns a dispose function to clean up.
 */
export function apply(ctx, config = {}) {
    const logger = ctx.logger || {
        info: () => { },
        error: () => { },
        warn: () => { },
        debug: () => { },
    };
    // 1. Get bot token from credentials or config
    let botToken;
    if (config.botToken) {
        botToken = config.botToken;
    }
    else if (ctx.credentials) {
        const cred = ctx.credentials.resolve("telegram:botToken");
        if (cred && "value" in cred && cred.value) {
            botToken = cred.value;
        }
        else {
            logger.warn("Telegram bot token not configured");
            return () => { };
        }
    }
    else {
        logger.warn("Telegram bot token not configured");
        return () => { };
    }
    // 2. Validate bot token
    if (!isValidBotToken(botToken)) {
        logger.warn("Telegram bot token not configured");
        return () => { };
    }
    // 3. Create TelegramBot instance
    const bot = new TelegramBot(botToken);
    // 3. Create router
    const router = createRouter(bot, {
        agents: ctx.agents,
        storage: ctx.storage,
        logger,
    });
    // 4. Create webhook handler
    const webhookPath = config.webhookPath || "/telegram/webhook";
    const webhookSecret = config.webhookSecret || botToken; // default to bot token if not set
    const webhookHandler = createWebhookHandler({
        webhookSecret,
        allowedChatIds: config.allowedChatIds,
    }, router);
    // 5. Register webhook route
    const dispose = ctx.webServer.register({
        kind: "prefix",
        path: webhookPath,
        handler: webhookHandler,
    });
    // 6. Set the webhook on Telegram
    const origin = ctx.webServer.getOrigin();
    const webhookUrl = `${origin}${webhookPath}`;
    bot.setWebhook(webhookUrl, webhookSecret).catch((err) => {
        logger.warn(`Failed to set Telegram webhook: ${err instanceof Error ? err.message : String(err)}`);
    });
    logger.info(`Telegram bot plugin loaded. Webhook URL: ${webhookUrl}`);
    // Return dispose function
    return () => {
        bot.deleteWebhook().catch(() => { });
        dispose();
        logger.info("Telegram bot plugin disposed");
    };
}

function isValidBotToken(token) {
    if (typeof token !== 'string') {
        return false;
    }
    if (token.length < 30) {
        return false;
    }
    if (!token.includes(':')) {
        return false;
    }
    return true;
}
//# sourceMappingURL=index.js.map