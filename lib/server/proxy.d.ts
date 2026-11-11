import tls from "node:tls";
import type { Socket } from "node:net";
/**
 * Resolve the proxy to use: an explicit setting wins over the environment.
 * A `socks://` URL is rejected because this module only speaks HTTP CONNECT.
 * @param explicit - proxy URL from the plugin config, if any.
 * @returns the parsed proxy URL, or undefined when no usable proxy is configured.
 */
export declare function resolveProxyUrl(explicit?: string): URL | undefined;
/**
 * Open a CONNECT tunnel to `host:port` through the proxy.
 * @param proxy - proxy URL with optional credentials.
 * @param host - target host name.
 * @param port - target TCP port.
 * @param timeoutMs - how long to wait for the proxy's `200 Connection established`.
 * @returns the raw socket carrying the tunnel.
 */
export declare function openTunnel(proxy: URL, host: string, port: number, timeoutMs: number): Promise<Socket>;
/**
 * Upgrade a tunnel socket to TLS for the target host.
 * @param socket - raw socket from {@link openTunnel}.
 * @param servername - SNI name and certificate host to verify.
 * @param timeoutMs - handshake timeout.
 * @returns the established TLS socket.
 */
export declare function secureTunnel(socket: Socket, servername: string, timeoutMs: number): Promise<tls.TLSSocket>;
//# sourceMappingURL=proxy.d.ts.map