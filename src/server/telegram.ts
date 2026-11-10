import http, { IncomingMessage } from "node:http";

const DEFAULT_API_BASE = "https://api.telegram.org";

export type HttpRequestFn = (
  options: { hostname: string; port?: number; path: string; method: string; headers?: Record<string, string> },
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
  private requestFn: HttpRequestFn;

  constructor(token: string, options?: { apiBase?: string; requestFn?: HttpRequestFn }) {
    this.token = token;
    this.apiBase = options?.apiBase ?? DEFAULT_API_BASE;
    this.requestFn = options?.requestFn ?? http.request;
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

  private doRequest<T>(url: string, body: string): Promise<TelegramResponse<T>> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const req = this.requestFn(
        {
          hostname: parsed.hostname,
          port: (parseInt(parsed.port, 10) || 443) as number | undefined,
          path: parsed.pathname + parsed.search,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(Buffer.byteLength(body)),
          },
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
      req.setTimeout(30000);
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
