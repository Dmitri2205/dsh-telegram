import http, { IncomingMessage } from "node:http";
import https from "node:https";
import type { Socket } from "node:net";
import { openTunnel, resolveProxyUrl, secureTunnel } from "./proxy.js";

const DEFAULT_API_BASE = "https://api.telegram.org";

/** How long one Telegram API call may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 30000;

export type HttpRequestFn = (
  options: {
    hostname: string;
    port?: number;
    path: string;
    method: string;
    headers?: Record<string, string>;
    createConnection?: () => Socket;
  },
  callback?: (res: IncomingMessage) => void,
) => {
  on(event: string, handler: (...args: any[]) => void): void;
  setTimeout(ms: number): void;
  write(data: string): boolean;
  end(): void;
  destroy(): void;
};

export class TelegramBot {
  private token: string;
  private apiBase: string;
  private requestFn?: HttpRequestFn;
  private proxyUrl?: string;

  constructor(token: string, options?: { apiBase?: string; requestFn?: HttpRequestFn; proxyUrl?: string }) {
    this.token = token;
    this.apiBase = options?.apiBase ?? DEFAULT_API_BASE;
    this.requestFn = options?.requestFn;
    this.proxyUrl = options?.proxyUrl;
  }

  private get baseUrl(): string {
    return `${this.apiBase}/bot${this.token}`;
  }

  /**
   * Make a request to the Telegram Bot API.
   * Implements retry logic:
   *   - 429 (Too Many Requests): wait and retry with exponential backoff
   *   - 500 (Server Error): retry up to 3 times with exponential backoff
   */
  async request<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const url = `${this.baseUrl}/${method}`;
    const payload = JSON.stringify(body);

    let retries = 0;
    const maxRetries = 3;
    let delay = 1000; // start with 1 second

    while (true) {
      const result = await this.doRequest<T>(url, payload);

      if (result.ok) {
        return result.result as T;
      }

      // Telegram error response
      const errorMsg = result.description || "Unknown error";
      const errorCode = result.error_code || 0;

      if (errorCode === 429) {
        // Too Many Requests — retry with backoff, respect retry_after
        retries++;
        if (retries > maxRetries) {
          throw new Error(`Telegram API rate limit exceeded: ${errorMsg}`);
        }
        // Use retry_after if provided, otherwise use calculated delay
        const retryAfter = (result as any).retry_after;
        if (retryAfter) {
          await this.sleep(retryAfter * 1000);
        } else {
          await this.sleep(delay);
        }
        delay *= 2;
        continue;
      }

      if (errorCode >= 500) {
        // Server error — retry
        retries++;
        if (retries > maxRetries) {
          throw new Error(`Telegram API server error (${errorCode}): ${errorMsg}`);
        }
        await this.sleep(delay);
        delay *= 2;
        continue;
      }

      // Other errors (400, 401, 403, 404, etc.) — throw immediately
      throw new Error(`Telegram API error (${errorCode}): ${errorMsg}`);
    }
  }

  /**
   * Open an HTTPS tunnel through the configured proxy, if any.
   * @param host - target host name.
   * @param port - target port.
   * @returns the TLS socket, or undefined when calls should go out directly.
   */
  private async openProxyTunnel(host: string, port: number): Promise<Socket | undefined> {
    const proxy = resolveProxyUrl(this.proxyUrl);
    if (proxy === undefined) return undefined;
    const raw = await openTunnel(proxy, host, port, REQUEST_TIMEOUT_MS);
    return secureTunnel(raw, host, REQUEST_TIMEOUT_MS);
  }

  private async doRequest<T>(url: string, body: string): Promise<TelegramResponse<T>> {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const port = parseInt(parsed.port, 10) || (isHttps ? 443 : 80);
    // A tunnel is already a TLS connection, so the request travels over plain http
    // on top of it; without a proxy, https.request dials Telegram directly.
    const tunnel = isHttps && this.requestFn === undefined ? await this.openProxyTunnel(parsed.hostname, port) : undefined;
    const requestFn = this.requestFn ?? (tunnel !== undefined || !isHttps ? http.request : https.request);
    return new Promise((resolve, reject) => {
      const req = requestFn(
        {
          hostname: parsed.hostname,
          port,
          path: parsed.pathname + parsed.search,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(Buffer.byteLength(body)),
          },
          ...(tunnel !== undefined ? { createConnection: () => tunnel } : {}),
        },
        (res: http.IncomingMessage) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
              resolve(data as TelegramResponse<T>);
            } catch {
              reject(new Error(`Failed to parse Telegram API response`));
            }
          });
          res.on("error", reject);
        },
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Telegram API request timeout"));
      });
      req.setTimeout(REQUEST_TIMEOUT_MS);
      req.write(body);
      req.end();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --- Convenience methods ---

  async getMe(): Promise<{ id: number; is_bot: boolean; username: string; first_name: string; last_name?: string }> {
    return this.request("getMe");
  }

  async sendText(
    chatId: number | string,
    text: string,
    extra: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.request("sendMessage", {
      chat_id: chatId,
      text,
      ...extra,
    });
  }

  async sendPhoto(
    chatId: number | string,
    photo: string,
    caption?: string,
    extra: Record<string, unknown> = {},
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      photo,
      ...extra,
    };
    if (caption) body.caption = caption;
    return this.request("sendPhoto", body);
  }

  async sendDocument(
    chatId: number | string,
    document: string,
    caption?: string,
    extra: Record<string, unknown> = {},
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      document,
      ...extra,
    };
    if (caption) body.caption = caption;
    return this.request("sendDocument", body);
  }

  async setWebhook(url: string, secret?: string): Promise<unknown> {
    const body: Record<string, unknown> = { url };
    if (secret) body.secret_token = secret;
    return this.request("setWebhook", body);
  }

  async deleteWebhook(): Promise<unknown> {
    return this.request("deleteWebhook");
  }

  async getFile(fileId: string): Promise<{ file_path: string }> {
    return this.request("getFile", { file_id: fileId });
  }
}

interface TelegramResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
  error_code?: number;
}
