import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { TelegramBot } from "./telegram.js";
import { createWebhookHandler } from "./webhook.js";
import { createRouter } from "./router.js";
export const name = "telegram-bot";
export const inject = ["agents", "webServer", "storage"];
/** Settings page route. Registered unconditionally so the UI works before a token exists. */
export const SETTINGS_PATH = "/telegram/api/settings";
/** Where the settings page persists the token and the chat whitelist. */
const SETTINGS_FILE = join(homedir(), ".dsh", "telegram-settings.json");
/** Upper bound for a settings POST body; the payload is two small fields. */
const MAX_SETTINGS_BODY = 64 * 1024;
/**
 * Config values from cordis.patch.yml are not env-interpolated by the loader, so an
 * unset token arrives as the literal `${TELEGRAM_BOT_TOKEN}`. Treat that as "not set".
 * @param raw - token candidate from the settings file or config.
 * @returns the usable token, or an empty string.
 */
function resolveToken(raw) {
    const token = (raw ?? "").trim();
    return token.startsWith("${") && token.endsWith("}") ? "" : token;
}
/**
 * Read the settings page values: the persisted file wins, config is the fallback.
 * @param config - plugin config from cordis.patch.yml.
 * @returns the effective token and chat whitelist.
 */
export function loadSettings(config = {}) {
    if (existsSync(SETTINGS_FILE)) {
        try {
            const parsed = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
            return {
                botToken: resolveToken(parsed.botToken) || resolveToken(config.botToken),
                allowedChatIds: parsed.allowedChatIds ?? config.allowedChatIds ?? [],
            };
        }
        catch {
            // A corrupt file must not brick the plugin — fall back to config.
        }
    }
    return { botToken: resolveToken(config.botToken), allowedChatIds: config.allowedChatIds || [] };
}
/**
 * Persist the settings page values.
 * @param settings - token and chat whitelist to store.
 */
export function saveSettings(settings) {
    mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
    writeFileSync(SETTINGS_FILE, JSON.stringify({ botToken: settings.botToken ?? "", allowedChatIds: settings.allowedChatIds ?? [] }, null, 2), { mode: 0o600 });
}
/**
 * HTTP handler for {@link SETTINGS_PATH}: GET returns the effective settings,
 * POST persists them.
 * @param config - plugin config, used as the fallback when no file exists.
 * @returns a node request handler.
 */
function createSettingsHandler(config) {
    return (req, res) => {
        if (req.method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(loadSettings(config)));
            return;
        }
        if (req.method !== "POST") {
            res.writeHead(405, { Allow: "GET, POST" });
            res.end();
            return;
        }
        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
            if (body.length > MAX_SETTINGS_BODY) {
                res.writeHead(413);
                res.end();
                req.destroy();
            }
        });
        req.on("end", () => {
            if (res.writableEnded)
                return;
            try {
                const parsed = JSON.parse(body);
                if (typeof parsed !== "object" || parsed === null)
                    throw new Error("body must be an object");
                const allowedChatIds = Array.isArray(parsed.allowedChatIds)
                    ? parsed.allowedChatIds.filter((id) => typeof id === "number" && Number.isFinite(id))
                    : [];
                saveSettings({ botToken: typeof parsed.botToken === "string" ? parsed.botToken.trim() : "", allowedChatIds });
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: true }));
            }
            catch {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid settings payload" }));
            }
        });
    };
}
/**
 * Apply the Telegram plugin.
 * Registers the settings API first, then the bot: router, webhook handler and
 * the webhook route. Returns a dispose function to clean up.
 */
export function apply(ctx, config = {}) {
    const logger = ctx.logger || {
        info: () => { },
        error: () => { },
        warn: () => { },
        debug: () => { },
    };
    const disposers = [];
    // 1. Settings API — registered before the token check so the page always works.
    disposers.push(ctx.webServer.register({
        kind: "exact",
        path: SETTINGS_PATH,
        handler: createSettingsHandler(config),
    }));
    const disposeAll = () => {
        for (const dispose of disposers.splice(0))
            dispose();
        logger.info("Telegram bot plugin disposed");
    };
    // 2. Get bot token from the settings file, config, or credentials
    const settings = loadSettings(config);
    let botToken;
    if (settings.botToken) {
        botToken = settings.botToken;
    }
    else if (ctx.credentials?.resolve("telegram:botToken")?.value) {
        botToken = ctx.credentials.resolve("telegram:botToken").value;
    }
    else {
        logger.warn(`Telegram bot token is not set. Open Settings → Telegram Bot (${SETTINGS_PATH}) to configure it.`);
        return disposeAll;
    }
    const allowedChatIds = settings.allowedChatIds.length > 0 ? settings.allowedChatIds : config.allowedChatIds;
    // 3. Create TelegramBot instance and the router
    const bot = new TelegramBot(botToken);
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
        allowedChatIds,
    }, router);
    // 5. Register webhook route
    disposers.push(ctx.webServer.register({
        kind: "prefix",
        path: webhookPath,
        handler: webhookHandler,
    }));
    // 6. Set the webhook on Telegram
    try {
        const webhookUrl = `${ctx.webServer.getOrigin()}${webhookPath}`;
        bot.setWebhook(webhookUrl, webhookSecret).catch((err) => {
            logger.warn(`Failed to set Telegram webhook: ${err instanceof Error ? err.message : String(err)}`);
        });
        logger.info(`Telegram bot plugin loaded. Webhook URL: ${webhookUrl}`);
    }
    catch (err) {
        logger.warn(`Telegram bot started without a webhook URL: ${err instanceof Error ? err.message : String(err)}`);
    }
    return () => {
        bot.deleteWebhook().catch(() => { });
        disposeAll();
    };
}
//# sourceMappingURL=index.js.map