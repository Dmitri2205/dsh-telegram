import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import assert from "node:assert/strict";

export function createFakeContext() {
  const routes = new Map<string, any>();
  const createdSessions = new Map<string, { sessionId: string; submitCalls: any[] }>();
  const resumedSessions = new Map<string, { sessionId: string; submitCalls: any[] }>();

  let nextSessionId = 1;

  const agents = {
    created: [] as any[],
    resumed: [] as any[],
    create: async (opts: any) => {
      const sessionId = `session-${nextSessionId++}`;
      const handle = {
        id: sessionId,
        submit: async (msg: any) => {
          const entry = createdSessions.get(sessionId) || { sessionId, submitCalls: [] };
          entry.submitCalls.push(msg);
          createdSessions.set(sessionId, entry);
          return { text: "test response" };
        },
      };
      createdSessions.set(sessionId, { sessionId, submitCalls: [] });
      agents.created.push({ opts, handle });
      return handle;
    },
    resume: async (opts: any) => {
      const sessionId = opts.sessionId;
      const handle = {
        id: sessionId,
        submit: async (msg: any) => {
          const entry = resumedSessions.get(sessionId) || { sessionId, submitCalls: [] as any[] };
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
    register: () => () => {},
  };

  const savedImages: any[] = [];
  const savedFiles: any[] = [];

  const attachments = {
    savedImages,
    savedFiles,
    saveImages: async (inputs: any[]) => {
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
    saveFile: async (input: any) => {
      savedFiles.push(input);
      return { attachmentId: `file-0`, name: input.name || "file", bytes: input.data.length };
    },
    saveFileStream: async (input: any) => ({
      attachmentId: "file-stream",
      name: input.name || "file",
      bytes: 0,
    }),
  };

  let resolvedCredential: string | null = null;
  const credentials = {
    resolved: resolvedCredential,
    resolve: (ref: string) => ({ value: resolvedCredential }),
  };

  const storageData = new Map<string, string>();
  const storageForm = {
    get: (key: string) => storageData.get(key),
    set: (key: string, value: string) => { storageData.set(key, value); },
  };
  const storage = {
    data: storageData,
    form: () => storageForm,
    mount: () => () => {},
    get: (key: string) => storageData.get(key),
    set: (key: string, value: string) => storageData.set(key, value),
  };

  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  const webServer = {
    register: (route: any) => {
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

export async function callRoute(
  route: any,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ status: number; body: string }> {
  const { method = "GET", headers = {}, body = "" } = opts;

  const req = Object.assign(Readable.from([Buffer.from(body)]), {
    method,
    headers,
  }) as IncomingMessage;

  const chunks: Buffer[] = [];
  const res = {
    statusCode: 200,
    _headers: {} as Record<string, string>,
    writeHead: (status: number, resHeaders?: Record<string, string>) => {
      res.statusCode = status;
      if (resHeaders) (res as any)._headers = resHeaders;
    },
    setHeader: (name: string, value: string) => {
      (res as any)._headers[name] = value;
    },
    end: (data?: string | Buffer) => {
      if (data) chunks.push(Buffer.from(data));
    },
  } as unknown as ServerResponse;

  await route.handler(req, res);

  return {
    status: res.statusCode,
    body: Buffer.concat(chunks).toString("utf-8"),
  };
}

export async function callWebhookHandler(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ status: number; body: string }> {
  const { method = "GET", headers = {}, body = "" } = opts;

  const req = Object.assign(Readable.from([Buffer.from(body)]), {
    method,
    headers,
  }) as IncomingMessage;

  const resChunks: Buffer[] = [];
  const res = {
    statusCode: 200,
    _headers: {} as Record<string, string>,
    writeHead: (status: number, resHeaders?: Record<string, string>) => {
      res.statusCode = status;
      if (resHeaders) (res as any)._headers = resHeaders;
    },
    setHeader: (name: string, value: string) => {
      (res as any)._headers[name] = value;
    },
    end: (data?: string | Buffer) => {
      if (data) resChunks.push(Buffer.from(data));
    },
  } as unknown as ServerResponse;

  await handler(req, res);

  return {
    status: res.statusCode,
    body: Buffer.concat(resChunks).toString("utf-8"),
  };
}
