import { Readable } from "node:stream";
import assert from "node:assert/strict";
// Re-export assert for convenience
export { assert };
/**
 * Create a fake DSH context for testing.
 */
export function createFakeContext() {
    const routes = new Map();
    const createdSessions = new Map();
    const resumedSessions = new Map();
    let nextSessionId = 1;
    const agents = {
        created: [],
        resumed: [],
        create: async (opts) => {
            const sessionId = `session-${nextSessionId++}`;
            const handle = {
                id: sessionId,
                submit: async (msg) => {
                    const entry = createdSessions.get(sessionId) || { sessionId, submitCalls: [] };
                    entry.submitCalls.push(msg);
                    createdSessions.set(sessionId, entry);
                    agents.created.push({ opts, handle });
                    return { text: "test response" };
                },
            };
            createdSessions.set(sessionId, { sessionId, submitCalls: [] });
            return handle;
        },
        resume: async (opts) => {
            const sessionId = opts.sessionId;
            const handle = {
                id: sessionId,
                submit: async (msg) => {
                    const entry = resumedSessions.get(sessionId) || { sessionId, submitCalls: [] };
                    entry.submitCalls.push(msg);
                    resumedSessions.set(sessionId, entry);
                    agents.resumed.push({ opts, handle });
                    return { text: "test response" };
                },
            };
            resumedSessions.set(sessionId, { sessionId, submitCalls: [] });
            return handle;
        },
        list: () => agents.created,
        roots: () => [],
        register: () => () => { },
    };
    const savedImages = [];
    const savedFiles = [];
    const attachments = {
        savedImages,
        savedFiles,
        saveImages: async (inputs) => {
            const refs = inputs.map((inp, i) => ({
                attachmentId: `img-${i}`,
                mediaType: inp.mediaType,
                bytes: inp.data.length,
                width: 100,
                height: 100,
            }));
            savedImages.push(...inputs);
            return refs;
        },
        saveFile: async (input) => {
            savedFiles.push(input);
            return { attachmentId: `file-0`, name: input.name || "file", bytes: input.data.length };
        },
        saveFileStream: async (input) => ({
            attachmentId: "file-stream",
            name: input.name || "file",
            bytes: 0,
        }),
    };
    let resolvedCredential = null;
    const credentials = {
        resolved: resolvedCredential,
        resolve: (ref) => ({ value: resolvedCredential }),
    };
    const storageData = new Map();
    const storageForm = {
        get: (key) => storageData.get(key),
        set: (key, value) => { storageData.set(key, value); },
    };
    const storage = {
        data: storageData,
        form: () => storageForm,
        mount: () => () => { },
        get: (key) => storageData.get(key),
        set: (key, value) => storageData.set(key, value),
    };
    const logger = {
        debug: () => { },
        info: () => { },
        warn: () => { },
        error: () => { },
    };
    const webServer = {
        register: (route) => {
            const key = `${route.kind}:${route.path}`;
            routes.set(key, route);
            return () => routes.delete(key);
        },
        getOrigin: () => "https://example.com",
    };
    return {
        routes,
        webServer,
        agents,
        attachments,
        credentials,
        storage,
        logger,
        createdSessions,
        resumedSessions,
    };
}
/**
 * Call a registered route with a fake HTTP request and collect the response.
 */
export async function callRoute(route, opts = {}) {
    const { method = "GET", headers = {}, body = "" } = opts;
    const req = Object.assign(Readable.from([Buffer.from(body)]), {
        method,
        headers,
    });
    const chunks = [];
    const res = {
        statusCode: 200,
        _headers: {},
        writeHead: (status, resHeaders) => {
            res.statusCode = status;
            if (resHeaders)
                res._headers = resHeaders;
        },
        setHeader: (name, value) => {
            res._headers[name] = value;
        },
        end: (data) => {
            if (data)
                chunks.push(Buffer.from(data));
        },
    };
    await route.handler(req, res);
    return {
        status: res.statusCode,
        body: Buffer.concat(chunks).toString("utf-8"),
    };
}
//# sourceMappingURL=helper.js.map