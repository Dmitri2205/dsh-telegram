import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import assert from "node:assert/strict";

export function createFakeContext() {
  const routes = new Map<string, any>();
  const createdSessions = new Map<string, { sessionId: string; followupCalls: any[]; disposed: number }>();
  const resumedSessions = new Map<string, { sessionId: string; followupCalls: any[]; disposed: number }>();

  /**
   * Fake `ctx.agents`. The real service is identity-driven: the caller supplies
   * the session id and drives the agent with `followup()` / `whenIdle()`, and the
   * assistant answer arrives as a durable `session/event`. Tests wire the event
   * back into the router through `agents.eventSink`.
   */
  const agents = {
    created: [] as any[],
    resumed: [] as any[],
    eventSink: undefined as ((sessionId: string, event: any) => void) | undefined,
    reply: "test response",
    create: async (opts: any) => makeHandle(opts?.sessionId ?? "session-unknown", "created", opts),
    resume: async (opts: any) => makeHandle(opts?.resumeSessionId ?? "session-unknown", "resumed", opts),
    list: () => [] as any[],
    roots: () => [] as any[],
    register: () => () => {},
  };

  function makeHandle(sessionId: string, kind: "created" | "resumed", opts: any) {
    const record = { sessionId, followupCalls: [] as any[], disposed: 0 };
    const agent = {
      id: sessionId,
      session: { id: sessionId },
      followup: (message: any) => {
        record.followupCalls.push(message);
        agents.eventSink?.(sessionId, {
          type: "assistant/message",
          data: { message: { content: [{ type: "text", text: agents.reply }] } },
        });
      },
      whenIdle: async () => {},
    };
    const handle = {
      agent,
      record,
      dispose: async () => { record.disposed += 1; },
    };
    (kind === "created" ? createdSessions : resumedSessions).set(sessionId, record);
    agents[kind].push({ opts, handle });
    return handle;
  }

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
