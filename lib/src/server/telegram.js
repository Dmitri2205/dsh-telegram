import http from "node:http";
const API_BASE = "https://api.telegram.org";
export class TelegramBot {
    token;
    constructor(token) {
        this.token = token;
    }
    get baseUrl() {
        return `${API_BASE}/bot${this.token}`;
    }
    /**
     * Make a request to the Telegram Bot API.
     * Implements retry logic:
     *   - 429 (Too Many Requests): wait and retry with exponential backoff
     *   - 500 (Server Error): retry up to 3 times with exponential backoff
     */
    async request(method, body = {}) {
        const url = `${this.baseUrl}/${method}`;
        const payload = JSON.stringify(body);
        let retries = 0;
        const maxRetries = 3;
        let delay = 1000; // start with 1 second
        while (true) {
            const result = await this.doRequest(url, payload);
            if (result.ok) {
                return result.result;
            }
            // Telegram error response
            const errorMsg = result.description || "Unknown error";
            const errorCode = result.error_code || 0;
            if (errorCode === 429) {
                // Too Many Requests — retry with backoff
                retries++;
                if (retries > maxRetries) {
                    throw new Error(`Telegram API rate limit exceeded: ${errorMsg}`);
                }
                await this.sleep(delay);
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
    doRequest(url, body) {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const req = http.request({
                hostname: parsed.hostname,
                port: parsed.port || 443,
                path: parsed.pathname + parsed.search,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body),
                },
            }, (res) => {
                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => {
                    try {
                        const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
                        resolve(data);
                    }
                    catch {
                        reject(new Error(`Failed to parse Telegram API response`));
                    }
                });
                res.on("error", reject);
            });
            req.on("error", reject);
            req.on("timeout", () => {
                req.destroy();
                reject(new Error("Telegram API request timeout"));
            });
            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error("Timeout"));
            });
            req.write(body);
            req.end();
        });
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    // --- Convenience methods ---
    async getMe() {
        return this.request("getMe");
    }
    async sendText(chatId, text, extra = {}) {
        return this.request("sendMessage", {
            chat_id: chatId,
            text,
            ...extra,
        });
    }
    async sendPhoto(chatId, photo, caption, extra = {}) {
        const body = {
            chat_id: chatId,
            photo,
            ...extra,
        };
        if (caption)
            body.caption = caption;
        return this.request("sendPhoto", body);
    }
    async sendDocument(chatId, document, caption, extra = {}) {
        const body = {
            chat_id: chatId,
            document,
            ...extra,
        };
        if (caption)
            body.caption = caption;
        return this.request("sendDocument", body);
    }
    async setWebhook(url, secret) {
        const body = { url };
        if (secret)
            body.secret_token = secret;
        return this.request("setWebhook", body);
    }
    async deleteWebhook() {
        return this.request("deleteWebhook");
    }
    async getFile(fileId) {
        return this.request("getFile", { file_id: fileId });
    }
}
//# sourceMappingURL=telegram.js.map