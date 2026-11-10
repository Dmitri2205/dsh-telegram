/**
 * Create a webhook handler for Telegram updates.
 * Validates the secret token, parses the update, and dispatches to the router.
 */
export function createWebhookHandler(config, router) {
    return async (req, res) => {
        // Only accept POST requests
        if (req.method !== "POST") {
            res.writeHead(405, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
        }
        // Read the body with size limit
        const chunks = [];
        let bodyLength = 0;
        const maxSize = 1048576; // 1MB
        for await (const chunk of req) {
            bodyLength += Buffer.from(chunk).length;
            if (bodyLength > maxSize) {
                res.writeHead(413, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Request Entity Too Large" }));
                return;
            }
            chunks.push(Buffer.from(chunk));
        }
        let body;
        try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        }
        catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
        }
        // Validate secret token if configured
        if (config.webhookSecret) {
            const receivedToken = req.headers["x-telegram-bot-api-secret-token"];
            if (receivedToken !== config.webhookSecret) {
                res.writeHead(403, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Forbidden: invalid secret token" }));
                return;
            }
        }
        // Handle different update types
        if (body.message) {
            await handleMessage(body.message, router, config.allowedChatIds);
        }
        else if (body.edited_message) {
            await handleMessage(body.edited_message, router, config.allowedChatIds);
        }
        else if (body.callback_query) {
            // Handle callback queries
            if (body.callback_query.message && "chat" in body.callback_query.message) {
                const chatId = body.callback_query.message.chat.id;
                if (isAllowed(chatId, config.allowedChatIds)) {
                    await router.routeMessage(chatId, {
                        text: `Callback: ${body.callback_query.data}`,
                    });
                }
            }
        }
        else {
            // Unknown update type — ignore
        }
        // Respond quickly with 200 OK
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
    };
}
async function handleMessage(message, router, allowedChatIds) {
    const chatId = message.chat.id;
    // Check if chat is allowed
    if (!isAllowed(chatId, allowedChatIds)) {
        return;
    }
    // Extract message content
    const text = message.text || message.caption;
    const photo = message.photo?.map((p) => p.file_id);
    const document = message.document?.file_id;
    await router.routeMessage(chatId, {
        text,
        photo,
        document,
    });
}
function isAllowed(chatId, allowedChatIds) {
    // If no whitelist configured, allow all
    if (!allowedChatIds || allowedChatIds.length === 0) {
        return true;
    }
    // Validate that chatId is a safe integer
    if (!Number.isSafeInteger(chatId)) {
        return false;
    }
    return allowedChatIds.includes(chatId);
}
//# sourceMappingURL=webhook.js.map