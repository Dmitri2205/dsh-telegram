const STORAGE_KEY_PREFIX = "telegram:chat:";
export function createRouter(bot, ctx) {
    // chatId → AgentHandle cache
    const chatToAgent = new Map();
    // chatId → sessionId (in-memory; lost on restart, recreated on next message)
    const chatToSession = new Map();
    return {
        async routeMessage(chatId, message) {
            let agent = chatToAgent.get(chatId);
            // If no cached agent, create or resume one
            if (!agent) {
                const sessionId = chatToSession.get(chatId);
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
                        // Remember the mapping so later messages resume this session
                        chatToSession.set(chatId, handle.id);
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
            // Forget the mapping so the next message starts fresh
            chatToSession.delete(chatId);
            ctx.logger.info(`New session requested for chat ${chatId}`);
        },
        listSessions() {
            return [...chatToSession].map(([chatId, sessionId]) => ({ chatId, sessionId }));
        },
    };
}
//# sourceMappingURL=router.js.map