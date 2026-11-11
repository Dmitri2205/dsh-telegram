import React, { useState, useEffect } from "react";

function TelegramSettings() {
  const [botToken, setBotToken] = useState("");
  const [allowedChatIds, setAllowedChatIds] = useState("");
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/telegram/api/settings")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: any) => {
        setBotToken(data.botToken || "");
        setAllowedChatIds((data.allowedChatIds || []).join(", "));
      })
      .catch((err) => {
        setError(`Не удалось загрузить настройки (${err instanceof Error ? err.message : String(err)}). Серверный плагин не загружен.`);
      })
      .finally(() => setLoading(false));
  }, []);

  const save = async (e: React.FormEvent) => {
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(`Не удалось сохранить (${err instanceof Error ? err.message : String(err)}).`);
      console.error("Failed to save:", err);
    }
  };

  if (loading) return <div style={{ padding: 16 }}>Загрузка...</div>;

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, maxWidth: 600 }}>
      <h3 style={{ margin: 0 }}>Telegram Bot</h3>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--dsw-alias-label-secondary, #aaa)" }}>Bot Token</label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="123456:ABC-DEF..."
            style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l1, #444)", background: "var(--dsw-alias-bg-layer-2, #1e1e1e)", color: "var(--dsw-alias-label-primary, #fff)" }}
          />
        </div>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--dsw-alias-label-secondary, #aaa)" }}>Allowed Chat IDs (comma separated)</label>
          <input
            type="text"
            value={allowedChatIds}
            onChange={(e) => setAllowedChatIds(e.target.value)}
            placeholder="1179622785"
            style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l1, #444)", background: "var(--dsw-alias-bg-layer-2, #1e1e1e)", color: "var(--dsw-alias-label-primary, #fff)" }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
          <button type="submit" style={{ padding: "8px 16px", background: "var(--dsw-alias-accent-primary, #3b82f6)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 500 }}>
            Сохранить
          </button>
          {saved && <span style={{ color: "#22c55e", fontSize: 13 }}>Сохранено! Перезапустите DSH для применения.</span>}
          {error && <span style={{ color: "#ef4444", fontSize: 13 }}>{error}</span>}
        </div>
      </form>
    </div>
  );
}

export const inject = ["slots"];

export function apply(ctx: any) {
  console.log("[dsh-telegram] apply() вызван");
  ctx.slots.inject("settings.section", () => {
    ctx.slots.register(
      {
        name: "settings.section",
        id: "telegram-settings",
        order: 10,
        label: () => "Telegram Bot",
      },
      TelegramSettings
    );
  });
}
