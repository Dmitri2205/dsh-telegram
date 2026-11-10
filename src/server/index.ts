import { AgentHandle, Agents, Storage } from "./router.js";
import { TelegramBot } from "./telegram.js";
import { createWebhookHandler } from "./webhook.js";
import { createRouter } from "./router.js";
export const inject = ["agents", "webServer", "storage"];


/**
 * Cordis interfaces — re-declared locally to avoid peer dependency issues.
 * The actual types come from @deepseek-ai/cordis at runtime.
 */
export interface WebServer {
  register(route: { kind: "exact" | "prefix"; path: string; handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void | Promise<void> }): () => void;
  getOrigin(): string;
}

export interface Attachments {
  saveImages(inputs: Array<{ data: Uint8Array; mediaType: string; name?: string }>): Promise<
    Array<{ attachmentId: string; mediaType: string; bytes: number; width?: number; height?: number }>
  >;
  saveFile(input: { data: Uint8Array; name?: string }): Promise<{ attachmentId: string; name: string; bytes: number }>;
  saveFileStream(input: { data: import("node:stream").Readable; name?: string }): Promise<{ attachmentId: string; name: string; bytes: number }>;
}

export interface ResolvedCredential {
  value: string | null;
}

export interface Credentials {
  resolve(ref: string): ResolvedCredential | undefined;
}

export interface TelegramConfig {
  botToken?: string;
  mode?: "webhook" | "polling";
  allowedChatIds?: number[];
  webhookSecret?: string;
  webhookPath?: string;
  maxFileSize?: number;
}

/**
 * Apply the Telegram plugin.
 * Sets up the bot, router, and webhook handler, then registers the webhook route.
 * Returns a dispose function to clean up.
 */
export function apply(
  ctx: {
    webServer: WebServer;
    agents: Agents;
    attachments: Attachments;
    credentials?: Credentials;
    storage: Storage;
    logger?: { info(msg: string): void; error(msg: string): void; warn(msg: string): void; debug(msg: string): void };
  },
  config: TelegramConfig = {},
): () => void {
  const logger = ctx.logger || {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  };

  // 1. Get bot token from credentials or config
  let botToken: string;
  if (config.botToken) {
    botToken = config.botToken;
  } else if (ctx.credentials) {
    const cred = ctx.credentials.resolve("telegram:botToken");
    if (cred && "value" in cred && cred.value) {
      botToken = cred.value as string;
    } else {
      throw new Error("Telegram bot token not configured. Provide it in config or via credentials.");
    }
  } else {
    throw new Error("Telegram bot token not configured. Provide it in config or via credentials.");
  }

  // 2. Create TelegramBot instance
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

  const webhookHandler = createWebhookHandler(
    {
      webhookSecret,
      allowedChatIds: config.allowedChatIds,
    },
    router,
  );

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
    bot.deleteWebhook().catch(() => {});
    dispose();
    logger.info("Telegram bot plugin disposed");
  };
}
