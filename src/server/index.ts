import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";

import { Agents } from "./router.js";
import { TelegramBot } from "./telegram.js";
import { createWebhookHandler } from "./webhook.js";
import { createRouter } from "./router.js";

export const name = "telegram-bot";
export const inject = ["agents", "webServer"];

/** Settings page route. Registered unconditionally so the UI works before a token exists. */
export const SETTINGS_PATH = "/telegram/api/settings";

/** Where the settings page persists the token and the chat whitelist. */
const SETTINGS_FILE = join(homedir(), ".dsh", "telegram-settings.json");

/**
 * Cordis interfaces — re-declared locally to avoid peer dependency issues.
 * The actual types come from @deepseek-ai/cordis at runtime.
 */
export interface WebServer {
  register(route: { kind: "exact" | "prefix"; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void;
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
  /** HTTP proxy for outbound Telegram calls; falls back to HTTPS_PROXY/HTTP_PROXY. */
  proxy?: string;
}

/** The subset of the config the settings page owns. */
export interface PersistedSettings {
  botToken?: string;
  allowedChatIds?: number[];
  /** Public URL Telegram must call. Empty means "derive from the server origin". */
  webhookUrl?: string;
}

/** Result of the last attempt to register the webhook with Telegram. */
export interface WebhookStatus {
  url: string;
  ok: boolean;
  error?: string;
  checkedAt: string;
}

/** Upper bound for a settings POST body; the payload is two small fields. */
const MAX_SETTINGS_BODY = 64 * 1024;

/**
 * Turn any thrown value into a readable message. Errors raised by transport layers
 * sometimes carry an empty `message` and keep the real cause in `cause`/`code`.
 * @param err - the thrown value.
 * @returns a non-empty description.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const parts = [err.message || err.name || ""];
    if (cause instanceof Error) parts.push(cause.message || cause.name || "");
    else if (cause !== undefined && cause !== null) parts.push(String(cause));
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") parts.push(`[${code}]`);
    // AggregateError (Node's happy-eyeballs connect) hides per-address failures here.
    const inner = (err as { errors?: unknown }).errors;
    if (Array.isArray(inner) && inner.length > 0) {
      const detailed = inner.map((entry) => {
        if (!(entry instanceof Error)) return String(entry);
        const entryCode = (entry as { code?: unknown }).code;
        const address = (entry as { address?: unknown }).address;
        const suffix = [typeof entryCode === "string" ? entryCode : "", typeof address === "string" ? address : ""]
          .filter((part) => part !== "")
          .join(" ");
        return suffix === "" ? `${entry.name}: ${entry.message}` : `${entry.name}: ${entry.message} (${suffix})`;
      });
      parts.push(detailed.join("; "));
    }
    const text = parts.filter((part) => part !== "").join(" ").trim();
    if (text !== "") return text;
    const stack = err.stack?.split("\n")[0]?.trim();
    return stack && stack !== "" ? stack : "unknown error (empty Error message)";
  }
  if (typeof err === "string" && err.trim() !== "") return err;
  try {
    const json = JSON.stringify(err);
    if (json && json !== "{}") return json;
  } catch {
    // fall through to a fixed label
  }
  return `unknown error (${typeof err})`;
}

/**
 * Config values from cordis.patch.yml are not env-interpolated by the loader, so an
 * unset token arrives as the literal `${TELEGRAM_BOT_TOKEN}`. Treat that as "not set".
 * @param raw - token candidate from the settings file or config.
 * @returns the usable token, or an empty string.
 */
function resolveToken(raw: string | undefined): string {
  const token = (raw ?? "").trim();
  return token.startsWith("${") && token.endsWith("}") ? "" : token;
}

/**
 * Read the settings page values: the persisted file wins, config is the fallback.
 * @param config - plugin config from cordis.patch.yml.
 * @returns the effective token and chat whitelist.
 */
export function loadSettings(config: TelegramConfig = {}): { botToken: string; allowedChatIds: number[]; webhookUrl: string } {
  if (existsSync(SETTINGS_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as PersistedSettings;
      return {
        botToken: resolveToken(parsed.botToken) || resolveToken(config.botToken),
        allowedChatIds: parsed.allowedChatIds ?? config.allowedChatIds ?? [],
        webhookUrl: typeof parsed.webhookUrl === "string" ? parsed.webhookUrl.trim() : "",
      };
    } catch {
      // A corrupt file must not brick the plugin — fall back to config.
    }
  }
  return { botToken: resolveToken(config.botToken), allowedChatIds: config.allowedChatIds || [], webhookUrl: "" };
}

/**
 * Persist the settings page values.
 * @param settings - token and chat whitelist to store.
 */
export function saveSettings(settings: PersistedSettings): void {
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  writeFileSync(
    SETTINGS_FILE,
    JSON.stringify(
      {
        botToken: settings.botToken ?? "",
        allowedChatIds: settings.allowedChatIds ?? [],
        webhookUrl: settings.webhookUrl ?? "",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

/**
 * Check that a value is an absolute http(s) URL Telegram could call.
 * @param value - candidate webhook URL.
 * @returns true when the URL is usable for setWebhook.
 */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * HTTP handler for {@link SETTINGS_PATH}: GET returns the effective settings,
 * POST persists them.
 * @param config - plugin config, used as the fallback when no file exists.
 * @param defaultWebhookUrl - URL the bot uses when no explicit webhook URL is set.
 * @returns a node request handler.
 */
function createSettingsHandler(
  config: TelegramConfig,
  defaultWebhookUrl: () => string,
  webhook: {
    getStatus: () => WebhookStatus | null;
    register: (url: string) => Promise<WebhookStatus>;
  },
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (req.method === "GET") {
      const settings = loadSettings(config);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          botToken: settings.botToken,
          allowedChatIds: settings.allowedChatIds,
          webhookUrl: settings.webhookUrl || defaultWebhookUrl(),
          webhookUrlIsExplicit: settings.webhookUrl !== "",
          webhookStatus: webhook.getStatus(),
        }),
      );
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "GET, POST" });
      res.end();
      return;
    }
    let body = "";
    req.on("data", (chunk: Buffer | string) => {
      body += chunk;
      if (body.length > MAX_SETTINGS_BODY) {
        res.writeHead(413);
        res.end();
        req.destroy();
      }
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      try {
        const parsed = JSON.parse(body) as PersistedSettings;
        if (typeof parsed !== "object" || parsed === null) throw new Error("body must be an object");
        const allowedChatIds = Array.isArray(parsed.allowedChatIds)
          ? parsed.allowedChatIds.filter((id): id is number => typeof id === "number" && Number.isFinite(id))
          : [];
        const webhookUrl =
          typeof parsed.webhookUrl === "string" ? parsed.webhookUrl.trim() : "";
        if (webhookUrl !== "" && !isHttpUrl(webhookUrl)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "webhookUrl must be an http(s) URL" }));
          return;
        }
        saveSettings({ botToken: typeof parsed.botToken === "string" ? parsed.botToken.trim() : "", allowedChatIds, webhookUrl });
        // Re-register immediately so the page shows Telegram's verdict without a restart.
        if (webhookUrl === "") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, webhookStatus: webhook.getStatus() }));
          return;
        }
        void webhook.register(webhookUrl).then((status) => {
          if (res.writableEnded) return;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, webhookStatus: status }));
        });
      } catch {
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
export function apply(
  ctx: {
    webServer: WebServer;
    agents: Agents;
    credentials?: Credentials;
    on?: (event: "session/event", handler: (session: { id: string }, event: unknown) => void) => () => void;
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
  const disposers: Array<() => void> = [];

  // Shared webhook state: the settings page shows Telegram's answer verbatim,
  // including the error text ("An HTTPS URL must be provided for webhook").
  let botInstance: TelegramBot | null = null;
  let webhookSecretValue = "";
  let webhookStatus: WebhookStatus | null = null;
  const registerWebhook = async (url: string): Promise<WebhookStatus> => {
    const checkedAt = new Date().toISOString();
    if (!botInstance) {
      webhookStatus = {
        url,
        ok: false,
        error: "Telegram bot is not running: the bot token is not set. Save a token and restart DSH.",
        checkedAt,
      };
      return webhookStatus;
    }
    try {
      await botInstance.setWebhook(url, webhookSecretValue || undefined);
      webhookStatus = { url, ok: true, checkedAt };
      logger.info(`Telegram webhook registered: ${url}`);
    } catch (err) {
      const error = describeError(err);
      webhookStatus = { url, ok: false, error, checkedAt };
      logger.warn(`Failed to set Telegram webhook: ${error}`);
      if (err instanceof Error && err.stack) logger.debug(err.stack);
      else logger.debug(`Raw webhook error: ${JSON.stringify(err)}`);
    }
    return webhookStatus;
  };

  // 1. Effective settings and the webhook target.
  //    An explicit public URL wins; otherwise the URL is derived from the server origin,
  //    which is often a loopback address Telegram cannot reach.
  const settings = loadSettings(config);
  let webhookPath = config.webhookPath || "/telegram/webhook";
  let explicitWebhookUrl = "";
  if (settings.webhookUrl) {
    try {
      const parsedUrl = new URL(settings.webhookUrl);
      explicitWebhookUrl = parsedUrl.toString();
      webhookPath = parsedUrl.pathname || webhookPath;
    } catch {
      // Validated on save; ignore a corrupted value and fall back to the origin.
    }
  }
  const localWebhookUrl = (): string => {
    try {
      return `${ctx.webServer.getOrigin()}${webhookPath}`;
    } catch {
      return "";
    }
  };

  // 2. Settings API — registered before the token check so the page always works.
  disposers.push(
    ctx.webServer.register({
      kind: "exact",
      path: SETTINGS_PATH,
      handler: createSettingsHandler(
        config,
        () => loadSettings(config).webhookUrl || localWebhookUrl(),
        { getStatus: () => webhookStatus, register: registerWebhook },
      ),
    }),
  );

  const disposeAll = (): void => {
    for (const dispose of disposers.splice(0)) dispose();
    logger.info("Telegram bot plugin disposed");
  };

  // 3. Get bot token from the settings file, config, or credentials
  let botToken: string;
  if (settings.botToken) {
    botToken = settings.botToken;
  } else if (ctx.credentials?.resolve("telegram:botToken")?.value) {
    botToken = ctx.credentials.resolve("telegram:botToken")!.value as string;
  } else {
    logger.warn(`Telegram bot token is not set. Open Settings → Telegram Bot (${SETTINGS_PATH}) to configure it.`);
    return disposeAll;
  }
  const allowedChatIds = settings.allowedChatIds.length > 0 ? settings.allowedChatIds : config.allowedChatIds;

  // 3. Create TelegramBot instance and the router
  const bot = new TelegramBot(botToken, { proxyUrl: config.proxy });
  botInstance = bot;
  const router = createRouter(bot, {
    agents: ctx.agents,
    logger,
    cwd: process.cwd(),
  });

  // Durable session events are how the assistant's answer reaches us: the loop
  // commits `assistant/message` events, and `router.handleSessionEvent` collects
  // their text for whichever chat is currently waiting on that session.
  if (ctx.on) {
    disposers.push(ctx.on("session/event", (session, event) => {
      router.handleSessionEvent(session.id, event as { type?: string; data?: { message?: { content?: Array<{ type?: string; text?: string }> } } });
    }));
  }

  disposers.push(() => { void router.dispose(); });

  // 4. Create webhook handler
  // Telegram rejects a secret_token with characters outside [A-Za-z0-9_-], and a bot
  // token always contains ":" — so derive a stable secret from the token instead.
  const webhookSecret =
    config.webhookSecret || createHash("sha256").update(`dsh-telegram:${botToken}`).digest("hex");
  webhookSecretValue = webhookSecret;

  const webhookHandler = createWebhookHandler(
    {
      webhookSecret,
      allowedChatIds,
    },
    router,
  );

  // 5. Register webhook route
  disposers.push(
    ctx.webServer.register({
      kind: "prefix",
      path: webhookPath,
      handler: webhookHandler,
    }),
  );

  // 6. Set the webhook on Telegram
  const webhookUrl = explicitWebhookUrl || localWebhookUrl();
  if (!webhookUrl) {
    logger.warn("Telegram bot started without a webhook URL: set a public Webhook URL in Settings → Telegram Bot.");
  } else if (!isHttpUrl(webhookUrl)) {
    logger.warn(`Telegram bot started with a non-http(s) webhook URL: ${webhookUrl}`);
  } else {
    void registerWebhook(webhookUrl);
    logger.info(`Telegram bot plugin loaded. Webhook URL: ${webhookUrl}`);
  }

  return () => {
    bot.deleteWebhook().catch(() => {});
    disposeAll();
  };
}
