import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import type { FolderPatch } from "../src/types.ts";
import type { Store } from "./db.ts";
import type { DriveSync } from "./driveSync.ts";

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

const readBody = async (req: IncomingMessage, limit = Infinity): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      throw new HttpError(413, "payload too large");
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const sendEmpty = (res: ServerResponse, status: number) => {
  res.writeHead(status);
  res.end();
};

const redirect = (res: ServerResponse, location: string) => {
  res.writeHead(302, { Location: location });
  res.end();
};

/** マウント位置以降のパスをセグメントに分解する */
const parseUrl = (req: IncomingMessage) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  return { segments, query: url.searchParams };
};

/** 例外を JSON のエラーレスポンスに変換する */
const handler =
  (
    name: string,
    fn: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  ): Connect.NextHandleFunction =>
  (req, res) => {
    fn(req, res).catch((err: unknown) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(`[${name}]`, err);
      sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
    });
  };

/**
 * /api/folders
 *   GET    /       全フォルダ（画像の参照・メッセージ込み）
 *   PUT    /:id    フォルダの保存
 *   DELETE /:id    フォルダの削除
 */
export const createFolderApi = (store: Store, drive: DriveSync) =>
  handler("folder-api", async (req, res) => {
    const { segments } = parseUrl(req);
    const [id] = segments;

    if (req.method === "GET" && !id) {
      sendJson(res, 200, store.listFolders());
      return;
    }
    if (req.method === "PUT" && id) {
      const patch = JSON.parse((await readBody(req)).toString("utf8")) as FolderPatch;
      if (patch.id !== id) throw new HttpError(400, "id mismatch");
      drive.removeImageFiles(store.saveFolder(patch));
      sendEmpty(res, 204);
      return;
    }
    if (req.method === "DELETE" && id) {
      drive.removeImageFiles(store.deleteFolder(id));
      sendEmpty(res, 204);
      return;
    }
    throw new HttpError(404, "not found");
  });

/**
 * /api/images
 *   POST /?folderId=xxx  画像の保存（body: 画像バイナリ）→ { id }
 *   GET  /:id            画像の取得
 */
export const createImageApi = (drive: DriveSync) =>
  handler("image-api", async (req, res) => {
    const { segments, query } = parseUrl(req);
    const [id] = segments;

    if (req.method === "POST" && !id) {
      const folderId = query.get("folderId");
      const mimeType = req.headers["content-type"] ?? "";
      if (!folderId) throw new HttpError(400, "folderId is required");
      if (!mimeType.startsWith("image/")) throw new HttpError(415, "image/* is required");
      const data = await readBody(req, MAX_IMAGE_BYTES);
      sendJson(res, 201, { id: await drive.saveImage(folderId, mimeType, data) });
      return;
    }
    if (req.method === "GET" && id) {
      const image = await drive.readImage(id);
      if (!image) throw new HttpError(404, "image not found");
      res.writeHead(200, {
        "Content-Type": image.mimeType,
        // 画像 ID ごとに内容は不変
        "Cache-Control": "private, max-age=31536000, immutable",
      });
      res.end(image.data);
      return;
    }
    throw new HttpError(404, "not found");
  });

/**
 * /api/auth/google
 *   GET  /status    接続状態
 *   GET  /login     Google の同意画面へリダイレクト
 *   GET  /callback  認可コードを受け取り、アプリに戻る
 *   POST /logout    接続解除（トークンを取り消す）
 */
export const createGoogleAuthApi = (drive: DriveSync) =>
  handler("google-auth", async (req, res) => {
    const { segments, query } = parseUrl(req);
    const [action] = segments;

    if (req.method === "GET" && action === "status") {
      sendJson(res, 200, drive.status());
      return;
    }
    if (req.method === "GET" && action === "login") {
      const url = drive.startLogin();
      if (!url) throw new HttpError(400, "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が未設定です");
      redirect(res, url);
      return;
    }
    if (req.method === "GET" && action === "callback") {
      const error = query.get("error");
      const code = query.get("code");
      const state = query.get("state");
      if (error || !code || !state) {
        redirect(res, `/?drive_error=${encodeURIComponent(error ?? "invalid_request")}`);
        return;
      }
      try {
        await drive.handleCallback(code, state);
      } catch (err) {
        console.error("[google-auth]", err);
        const message = err instanceof Error ? err.message : String(err);
        redirect(res, `/?drive_error=${encodeURIComponent(message)}`);
        return;
      }
      redirect(res, "/");
      return;
    }
    if (req.method === "POST" && action === "logout") {
      await drive.logout();
      sendEmpty(res, 204);
      return;
    }
    throw new HttpError(404, "not found");
  });
