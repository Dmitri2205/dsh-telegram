/**
 * Cordis interfaces — re-declared locally to avoid peer dependency issues.
 * The actual shapes come from @deepseek-ai/cordis and dsh-agent at runtime.
 */
import { randomUUID } from "node:crypto";
import { handleCommand, parseCommand } from "./commands.js";
export function createRouter(bot, ctx) {
    // chatId → AgentHandle cache
    const chatToAgent = new Map();
    // chatId → sessionId (in-memory; lost on restart, recreated on next message)
    const chatToSession = new Map();
    // sessionId → text collected from assistant/message events of the running turn
    const inflightText = new Map();
    async function ensureAgent(chatId) {
        const cached = chatToAgent.get(chatId);
        if (cached)
            return cached;
        const sessionId = chatToSession.get(chatId);
        const handle = sessionId
            ? await ctx.agents.resume({ resumeSessionId: sessionId })
            : await ctx.agents.create({
                sessionId: `telegram-${chatId}-${randomUUID()}`,
                meta: ctx.cwd === undefined ? undefined : { cwd: ctx.cwd },
            });
        chatToAgent.set(chatId, handle);
        chatToSession.set(chatId, handle.agent.session.id);
        ctx.logger.info(`${sessionId ? "Resumed" : "Created"} session ${handle.agent.session.id} for chat ${chatId}`);
        return handle;
    }
    return {
        async routeMessage(chatId, message) {
            const text = message.text?.trim();
            if (!text)
                return;
            // Commands are answered locally: they must not consume a turn of the agent.
            const parsed = parseCommand(text);
            if (parsed) {
                const result = await handleCommand(parsed.command, parsed.args, chatId, { newSession, listSessions });
                if (result.text)
                    await reply(chatId, result.text);
                return;
            }
            let handle;
            try {
                handle = await ensureAgent(chatId);
            }
            catch (err) {
                ctx.logger.error(`Failed to create/resume agent for chat ${chatId}: ${describe(err)}`);
                await reply(chatId, "⚠️ Failed to process your message. Please try again or use /new to start a fresh session.");
                return;
            }
            const sessionId = handle.agent.session.id;
            const collected = [];
            inflightText.set(sessionId, collected);
            try {
                handle.agent.followup({
                    id: randomUUID(),
                    role: "user",
                    content: [{ type: "text", text }],
                    source: { kind: "user" },
                });
                await handle.agent.whenIdle();
            }
            catch (err) {
                ctx.logger.error(`Agent submission failed for chat ${chatId}: ${describe(err)}`);
                await reply(chatId, "⚠️ An error occurred while processing your message. Please try again.");
                return;
            }
            finally {
                inflightText.delete(sessionId);
            }
            const answer = collected.join("").trim();
            if (answer.length > 0) {
                await reply(chatId, answer);
            }
        },
        newSession,
        listSessions,
        handleSessionEvent(sessionId, event) {
            const collected = inflightText.get(sessionId);
            if (!collected || event?.type !== "assistant/message")
                return;
            for (const block of event.data?.message?.content ?? []) {
                if (block?.type === "text" && typeof block.text === "string")
                    collected.push(block.text);
            }
        },
        async dispose() {
            const handles = [...chatToAgent.values()];
            chatToAgent.clear();
            chatToSession.clear();
            inflightText.clear();
            await Promise.all(handles.map((handle) => handle.dispose().catch((err) => {
                ctx.logger.error(`Failed to dispose agent: ${describe(err)}`);
            })));
        },
    };
    function newSession(chatId) {
        const handle = chatToAgent.get(chatId);
        chatToAgent.delete(chatId);
        chatToSession.delete(chatId);
        if (handle) {
            void handle.dispose().catch((err) => {
                ctx.logger.error(`Failed to dispose agent for chat ${chatId}: ${describe(err)}`);
            });
        }
        ctx.logger.info(`New session requested for chat ${chatId}`);
    }
    function listSessions() {
        return [...chatToSession].map(([chatId, sessionId]) => ({ chatId, sessionId }));
    }
    async function reply(chatId, text) {
        try {
            await bot.sendText(chatId, text);
        }
        catch (err) {
            ctx.logger.error(`Failed to send message to chat ${chatId}: ${describe(err)}`);
        }
    }
}
function describe(err) {
    return err instanceof Error ? err.message : String(err);
}
//# sourceMappingURL=router.js.map