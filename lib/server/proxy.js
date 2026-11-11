/**
 * Minimal HTTP CONNECT tunnel support for outbound calls to the Telegram Bot API.
 *
 * The DSH process often runs behind a local proxy (clash/dante/squid) while the
 * Telegram API is unreachable directly — the raw `http`/`https` modules ignore
 * `HTTPS_PROXY`, so such a process fails with `ETIMEDOUT` unless the tunnel is
 * opened by hand.
 * @module telegram/proxy
 */
import http from "node:http";
import tls from "node:tls";
/** Environment variables consulted for the proxy URL, in priority order. */
const PROXY_ENV_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
/**
 * Resolve the proxy to use: an explicit setting wins over the environment.
 * A `socks://` URL is rejected because this module only speaks HTTP CONNECT.
 * @param explicit - proxy URL from the plugin config, if any.
 * @returns the parsed proxy URL, or undefined when no usable proxy is configured.
 */
export function resolveProxyUrl(explicit) {
    const candidates = [explicit, ...PROXY_ENV_KEYS.map((key) => process.env[key])];
    for (const candidate of candidates) {
        const raw = (candidate ?? "").trim();
        if (raw === "" || (raw.startsWith("${") && raw.endsWith("}")))
            continue;
        let url;
        try {
            url = new URL(raw);
        }
        catch {
            continue;
        }
        if (url.protocol !== "http:" && url.protocol !== "https:")
            continue;
        return url;
    }
    return undefined;
}
/**
 * Open a CONNECT tunnel to `host:port` through the proxy.
 * @param proxy - proxy URL with optional credentials.
 * @param host - target host name.
 * @param port - target TCP port.
 * @param timeoutMs - how long to wait for the proxy's `200 Connection established`.
 * @returns the raw socket carrying the tunnel.
 */
export function openTunnel(proxy, host, port, timeoutMs) {
    return new Promise((resolve, reject) => {
        const target = `${host}:${port}`;
        const headers = { Host: target };
        if (proxy.username !== "") {
            const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
            headers["Proxy-Authorization"] = `Basic ${Buffer.from(credentials).toString("base64")}`;
        }
        const request = http.request({
            host: proxy.hostname,
            port: Number(proxy.port) || 8080,
            method: "CONNECT",
            path: target,
            headers,
        });
        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`proxy ${proxy.host} did not answer CONNECT ${target} within ${timeoutMs}ms`));
        });
        request.on("connect", (response, socket) => {
            if (response.statusCode !== 200) {
                socket.destroy();
                const reason = response.statusMessage ? ` ${response.statusMessage}` : "";
                reject(new Error(`proxy ${proxy.host} refused CONNECT ${target}: ${response.statusCode}${reason}`));
                return;
            }
            resolve(socket);
        });
        request.on("error", reject);
        request.end();
    });
}
/**
 * Upgrade a tunnel socket to TLS for the target host.
 * @param socket - raw socket from {@link openTunnel}.
 * @param servername - SNI name and certificate host to verify.
 * @param timeoutMs - handshake timeout.
 * @returns the established TLS socket.
 */
export function secureTunnel(socket, servername, timeoutMs) {
    return new Promise((resolve, reject) => {
        const secure = tls.connect({ socket, servername, ALPNProtocols: ["http/1.1"] });
        secure.setTimeout(timeoutMs, () => {
            secure.destroy(new Error(`TLS handshake with ${servername} timed out after ${timeoutMs}ms`));
        });
        secure.once("secureConnect", () => resolve(secure));
        secure.once("error", reject);
    });
}
//# sourceMappingURL=proxy.js.map