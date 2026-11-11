import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
function TelegramSettings() {
    const [botToken, setBotToken] = useState("");
    const [allowedChatIds, setAllowedChatIds] = useState("");
    const [loading, setLoading] = useState(true);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        fetch("/telegram/api/settings")
            .then((r) => {
            if (!r.ok)
                throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
            .then((data) => {
            setBotToken(data.botToken || "");
            setAllowedChatIds((data.allowedChatIds || []).join(", "));
        })
            .catch((err) => {
            setError(`Не удалось загрузить настройки (${err instanceof Error ? err.message : String(err)}). Серверный плагин не загружен.`);
        })
            .finally(() => setLoading(false));
    }, []);
    const save = async (e) => {
        e.preventDefault();
        setSaved(false);
        setError("");
        const ids = allowedChatIds.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
        try {
            const res = await fetch("/telegram/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ botToken, allowedChatIds: ids }),
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        }
        catch (err) {
            setError(`Не удалось сохранить (${err instanceof Error ? err.message : String(err)}).`);
            console.error("Failed to save:", err);
        }
    };
    if (loading)
        return _jsx("div", { style: { padding: 16 }, children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430..." });
    return (_jsxs("div", { style: { padding: 16, display: "flex", flexDirection: "column", gap: 12, maxWidth: 600 }, children: [_jsx("h3", { style: { margin: 0 }, children: "Telegram Bot" }), _jsxs("form", { onSubmit: save, style: { display: "flex", flexDirection: "column", gap: 12 }, children: [_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: [_jsx("label", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #aaa)" }, children: "Bot Token" }), _jsx("input", { type: "password", value: botToken, onChange: (e) => setBotToken(e.target.value), placeholder: "123456:ABC-DEF...", style: { padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l1, #444)", background: "var(--dsw-alias-bg-layer-2, #1e1e1e)", color: "var(--dsw-alias-label-primary, #fff)" } })] }), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: [_jsx("label", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #aaa)" }, children: "Allowed Chat IDs (comma separated)" }), _jsx("input", { type: "text", value: allowedChatIds, onChange: (e) => setAllowedChatIds(e.target.value), placeholder: "1179622785", style: { padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l1, #444)", background: "var(--dsw-alias-bg-layer-2, #1e1e1e)", color: "var(--dsw-alias-label-primary, #fff)" } })] }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12, marginTop: 8 }, children: [_jsx("button", { type: "submit", style: { padding: "8px 16px", background: "var(--dsw-alias-accent-primary, #3b82f6)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 500 }, children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C" }), saved && _jsx("span", { style: { color: "#22c55e", fontSize: 13 }, children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E! \u041F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435 DSH \u0434\u043B\u044F \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0438\u044F." }), error && _jsx("span", { style: { color: "#ef4444", fontSize: 13 }, children: error })] })] })] }));
}
export const inject = ["slots"];
export function apply(ctx) {
    console.log("[dsh-telegram] apply() вызван");
    ctx.slots.inject("settings.section", () => {
        ctx.slots.register({
            name: "settings.section",
            id: "telegram-settings",
            order: 10,
            label: () => "Telegram Bot",
        }, TelegramSettings);
    });
}
//# sourceMappingURL=index.js.map