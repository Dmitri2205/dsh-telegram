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
        // Read the body
        const chunks = [];
        for await (const chunk of req) {
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
        // Handle different update types. An escaping rejection would be answered by the
        // host's last-resort guard as an empty 400, hiding the real cause — so surface it.
        try {
            await dispatchUpdate(body, router, config.allowedChatIds);
        }
        catch (err) {
            const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Webhook handler failed: ${detail}` }));
            return;
        }
        // Respond quickly with 200 OK
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
    };
}
async function dispatchUpdate(body, router, allowedChatIds) {
    if (body.message) {
        await handleMessage(body.message, router, allowedChatIds);
    }
    else if (body.edited_message) {
        await handleMessage(body.edited_message, router, allowedChatIds);
    }
    else if (body.callback_query) {
        // Handle callback queries
        if (body.callback_query.message && "chat" in body.callback_query.message) {
            const chatId = body.callback_query.message.chat.id;
            if (isAllowed(chatId, allowedChatIds)) {
                await router.routeMessage(chatId, {
                    text: `Callback: ${body.callback_query.data}`,
                });
            }
        }
    }
    else {
        // Unknown update type — ignore
    }
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
    return allowedChatIds.includes(chatId);
}
//# sourceMappingURL=webhook.js.map