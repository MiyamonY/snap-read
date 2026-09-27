import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Application } from "@oak/oak";
import type { Connect } from "vite";

/** Node の IncomingMessage を Web 標準の Request に変換する */
const toRequest = (req: IncomingMessage): Request => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`), {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
    duplex: "half",
  } as RequestInit);
};

/** Web 標準の Response を Node の ServerResponse に書き出す */
const writeResponse = async (response: Response, res: ServerResponse): Promise<void> => {
  res.statusCode = response.status;
  for (const [key, value] of response.headers) {
    if (key !== "set-cookie") res.setHeader(key, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);

  if (!response.body) {
    res.end();
    return;
  }
  for await (const chunk of response.body) {
    res.write(chunk);
  }
  res.end();
};

/**
 * Oak アプリケーションを Vite（connect）のミドルウェアとして使う。
 * prefix に一致しないリクエストは Vite 側の処理に回す
 */
export const oakMiddleware =
  (app: Application, prefix: string): Connect.NextHandleFunction =>
  (req, res, next) => {
    if (!req.url?.startsWith(prefix)) {
      next();
      return;
    }
    const handle = async () => {
      try {
        const response = await app.handle(toRequest(req));
        if (!response) {
          next();
          return;
        }
        await writeResponse(response, res);
      } catch (err) {
        next(err);
      }
    };
    handle();
  };
