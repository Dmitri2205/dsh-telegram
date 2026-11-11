window.__ModuleLoader__.load({
  id: '@local/dsh-telegram',
  factory(require) {
    const module = { exports: {} };
    const exports = module.exports;
    (function(module, exports, require) {
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function TelegramSettings() {
  const [botToken, setBotToken] = (0, import_react.useState)("");
  const [allowedChatIds, setAllowedChatIds] = (0, import_react.useState)("");
  const [loading, setLoading] = (0, import_react.useState)(true);
  const [saved, setSaved] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)("");
  (0, import_react.useEffect)(() => {
    fetch("/telegram/api/settings").then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }).then((data) => {
      setBotToken(data.botToken || "");
      setAllowedChatIds((data.allowedChatIds || []).join(", "));
    }).catch((err) => {
      setError(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 (${err instanceof Error ? err.message : String(err)}). \u0421\u0435\u0440\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u043B\u0430\u0433\u0438\u043D \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D.`);
    }).finally(() => setLoading(false));
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
        body: JSON.stringify({ botToken, allowedChatIds: ids })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 3e3);
    } catch (err) {
      setError(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C (${err instanceof Error ? err.message : String(err)}).`);
      console.error("Failed to save:", err);
    }
  };
  if (loading) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { padding: 16 }, children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430..." });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: 16, display: "flex", flexDirection: "column", gap: 12, maxWidth: 600 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: { margin: 0 }, children: "Telegram Bot" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { onSubmit: save, style: { display: "flex", flexDirection: "column", gap: 12 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #aaa)" }, children: "Bot Token" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "password",
            value: botToken,
            onChange: (e) => setBotToken(e.target.value),
            placeholder: "123456:ABC-DEF...",
            style: { padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l1, #444)", background: "var(--dsw-alias-bg-layer-2, #1e1e1e)", color: "var(--dsw-alias-label-primary, #fff)" }
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #aaa)" }, children: "Allowed Chat IDs (comma separated)" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "text",
            value: allowedChatIds,
            onChange: (e) => setAllowedChatIds(e.target.value),
            placeholder: "1179622785",
            style: { padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l1, #444)", background: "var(--dsw-alias-bg-layer-2, #1e1e1e)", color: "var(--dsw-alias-label-primary, #fff)" }
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 12, marginTop: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "submit", style: { padding: "8px 16px", background: "var(--dsw-alias-accent-primary, #3b82f6)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 500 }, children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C" }),
        saved && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: "#22c55e", fontSize: 13 }, children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E! \u041F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435 DSH \u0434\u043B\u044F \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0438\u044F." }),
        error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: "#ef4444", fontSize: 13 }, children: error })
      ] })
    ] })
  ] });
}
var inject = ["slots"];
function apply(ctx) {
  console.log("[dsh-telegram] apply() \u0432\u044B\u0437\u0432\u0430\u043D");
  ctx.slots.inject("settings.section", () => {
    ctx.slots.register(
      {
        name: "settings.section",
        id: "telegram-settings",
        order: 10,
        label: () => "Telegram Bot"
      },
      TelegramSettings
    );
  });
}

    })(module, exports, require);
    return module.exports;
  }
});