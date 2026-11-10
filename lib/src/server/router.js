const STORAGE_KEY_PREFIX = "telegram:chat:";
export function createRouter(bot, ctx) {
    // chatId → AgentHandle cache
    const chatToAgent = new Map();
    // Load persisted mappings from storage
    const persistedSessions = loadPersistedSessions(ctx.storage);
    for (const [chatIdStr, sessionId] of Object.entries(persistedSessions)) {
        const chatId = parseInt(chatIdStr, 10);
        if (!isNaN(chatId)) {
            ctx.logger.info(`Restored session mapping: chat ${chatId} → session ${sessionId}`);
        }
    }
    return {
        async routeMessage(chatId, message) {
            let agent = chatToAgent.get(chatId);
            // If no cached agent, create or resume one
            if (!agent) {
                const sessionId = ctx.storage
                    .form()
                    .get(`${STORAGE_KEY_PREFIX}${chatId}`);
                try {
                    if (sessionId) {
                        // Resume existing session
                        const handle = await ctx.agents.resume({ sessionId });
                        agent = handle;
                        chatToAgent.set(chatId, agent);
                        ctx.logger.info(`Resumed session ${sessionId} for chat ${chatId}`);
                    }
                    else {
                        // Create new session
                        const handle = await ctx.agents.create({
                            prompt: message.text || undefined,
                        });
                        agent = handle;
                        chatToAgent.set(chatId, agent);
                        // Persist the mapping
                        ctx.storage
                            .form()
                            .set(`${STORAGE_KEY_PREFIX}${chatId}`, handle.id);
                        ctx.logger.info(`Created new session ${handle.id} for chat ${chatId}`);
                    }
                }
                catch (err) {
                    ctx.logger.error(`Failed to create/resume agent for chat ${chatId}: ${err instanceof Error ? err.message : String(err)}`);
                    try {
                        await bot.sendText(chatId, "⚠️ Failed to process your message. Please try again or use /new to start a fresh session.");
                    }
                    catch (sendErr) {
                        ctx.logger.error(`Failed to send error message: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
                    }
                    return;
                }
            }
            // Submit the message to the agent
            try {
                const response = await agent.submit({
                    text: message.text,
                });
                if (response?.text) {
                    await bot.sendText(chatId, response.text);
                }
            }
            catch (err) {
                ctx.logger.error(`Agent submission failed for chat ${chatId}: ${err instanceof Error ? err.message : String(err)}`);
                try {
                    await bot.sendText(chatId, "⚠️ An error occurred while processing your message. Please try again.");
                }
                catch (sendErr) {
                    ctx.logger.error(`Failed to send error message: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
                }
            }
        },
        newSession(chatId) {
            // Remove cached agent
            chatToAgent.delete(chatId);
            // Remove persisted mapping
            ctx.storage
                .form()
                .set(`${STORAGE_KEY_PREFIX}${chatId}`, "");
            ctx.logger.info(`New session requested for chat ${chatId}`);
        },
        listSessions() {
            const sessions = [];
            for (const [chatIdStr, sessionId] of Object.entries(persistedSessions)) {
                const chatId = parseInt(chatIdStr, 10);
                if (!isNaN(chatId) && sessionId) {
                    sessions.push({ chatId, sessionId });
                }
            }
            return sessions;
        },
    };
}
function loadPersistedSessions(storage) {
    const result = {};
    // We can't enumerate all keys, so we rely on the chatToAgent map
    // and the fact that new sessions will be persisted on creation.
    // This function is a placeholder for potential future persistence.
    return result;
}
//# sourceMappingURL=router.js.map