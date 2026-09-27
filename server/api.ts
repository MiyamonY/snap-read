import { Application, createHttpError, isHttpError, Router, Status } from "@oak/oak";
import type { FolderPatch, VocabularyInput } from "../src/types.ts";
import type { Store } from "./db.ts";
import { AuthError } from "./errors.ts";
import type { DriveSync } from "./driveSync.ts";
import { recognizeText } from "./vision.ts";

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

interface ApiDeps {
  store: Store;
  drive: DriveSync;
  /** POST /api/shutdown で呼ばれる（デスクトップアプリの終了用） */
  onShutdown: () => void;
}

/**
 * /api/folders
 *   GET    /       全フォルダ（画像の参照・メッセージ込み）
 *   PUT    /:id    フォルダの保存
 *   DELETE /:id    フォルダの削除
 *   GET    /:id/words         フォルダの単語帳
 *   PUT    /:id/words/:word   単語の登録・更新
 *   DELETE /:id/words/:word   単語の削除
 */
const folderRouter = ({ store, drive }: ApiDeps) =>
  new Router({ prefix: "/api/folders" })
    .get("/", (ctx) => {
      ctx.response.body = store.listFolders();
    })
    .put("/:id", async (ctx) => {
      const patch = (await ctx.request.body.json()) as FolderPatch;
      if (patch.id !== ctx.params.id) throw createHttpError(Status.BadRequest, "id mismatch");
      drive.removeImageFiles(store.saveFolder(patch));
      ctx.response.status = Status.NoContent;
    })
    .delete("/:id", (ctx) => {
      drive.removeImageFiles(store.deleteFolder(ctx.params.id));
      ctx.response.status = Status.NoContent;
    })
    .get("/:id/words", (ctx) => {
      ctx.response.body = store.listFolderWords(ctx.params.id);
    })
    .put("/:id/words/:word", async (ctx) => {
      const { id, word } = ctx.params;
      if (!store.folderExists(id)) throw createHttpError(Status.NotFound, "folder not found");
      const input = (await ctx.request.body.json()) as VocabularyInput;
      if (!input.meaning || !input.partOfSpeech) {
        throw createHttpError(Status.BadRequest, "meaning and partOfSpeech are required");
      }
      store.saveFolderWord(id, word, input);
      ctx.response.status = Status.NoContent;
    })
    .delete("/:id/words/:word", (ctx) => {
      store.deleteFolderWord(ctx.params.id, ctx.params.word);
      ctx.response.status = Status.NoContent;
    });

/**
 * /api/images
 *   POST /?folderId=xxx  画像の保存（body: 画像バイナリ）→ { id }
 *   GET  /:id            画像の取得
 */
const imageRouter = ({ drive }: ApiDeps) =>
  new Router({ prefix: "/api/images" })
    .post("/", async (ctx) => {
      const folderId = ctx.request.url.searchParams.get("folderId");
      const mimeType = ctx.request.headers.get("content-type") ?? "";
      if (!folderId) throw createHttpError(Status.BadRequest, "folderId is required");
      if (!mimeType.startsWith("image/")) {
        throw createHttpError(Status.UnsupportedMediaType, "image/* is required");
      }
      if (Number(ctx.request.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) {
        throw createHttpError(Status.RequestEntityTooLarge, "payload too large");
      }
      const data = new Uint8Array(await ctx.request.body.arrayBuffer());
      if (data.byteLength > MAX_IMAGE_BYTES) {
        throw createHttpError(Status.RequestEntityTooLarge, "payload too large");
      }
      ctx.response.status = Status.Created;
      ctx.response.body = { id: await drive.saveImage(folderId, mimeType, data) };
    })
    .get("/:id", async (ctx) => {
      const image = await drive.readImage(ctx.params.id);
      if (!image) throw createHttpError(Status.NotFound, "image not found");
      ctx.response.type = image.mimeType;
      // 画像 ID ごとに内容は不変
      ctx.response.headers.set("Cache-Control", "private, max-age=31536000, immutable");
      ctx.response.body = image.data;
    });

/**
 * /api/auth/google
 *   GET  /status    接続状態
 *   GET  /login     Google の同意画面へリダイレクト
 *   GET  /callback  認可コードを受け取り、アプリに戻る
 *   POST /logout    接続解除（トークンを取り消す）
 */
const googleAuthRouter = ({ drive }: ApiDeps) =>
  new Router({ prefix: "/api/auth/google" })
    .get("/status", (ctx) => {
      ctx.response.body = drive.status();
    })
    .get("/login", (ctx) => {
      const url = drive.startLogin();
      if (!url) {
        throw createHttpError(
          Status.BadRequest,
          "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が未設定です",
        );
      }
      ctx.response.redirect(url);
    })
    .get("/callback", async (ctx) => {
      const query = ctx.request.url.searchParams;
      const error = query.get("error");
      const code = query.get("code");
      const state = query.get("state");
      if (error || !code || !state) {
        ctx.response.redirect(`/?drive_error=${encodeURIComponent(error ?? "invalid_request")}`);
        return;
      }
      try {
        await drive.handleCallback(code, state);
      } catch (err) {
        console.error("[google-auth]", err);
        const message = err instanceof Error ? err.message : String(err);
        ctx.response.redirect(`/?drive_error=${encodeURIComponent(message)}`);
        return;
      }
      ctx.response.redirect("/");
    })
    .post("/logout", async (ctx) => {
      await drive.logout();
      ctx.response.status = Status.NoContent;
    });

/**
 * /api/ocr
 *   POST /  body: { imageIds: string[] } → { text }  保存済みの画像を Cloud Vision で文字認識する
 */
const ocrRouter = ({ drive }: ApiDeps) =>
  new Router({ prefix: "/api/ocr" }).post("/", async (ctx) => {
    let accessToken: string;
    try {
      accessToken = await drive.getAccessToken();
    } catch (err) {
      if (err instanceof AuthError) throw createHttpError(Status.Unauthorized, err.message);
      throw err;
    }
    const { imageIds } = (await ctx.request.body.json()) as { imageIds?: string[] };
    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      throw createHttpError(Status.BadRequest, "imageIds is required");
    }
    const images = await Promise.all(
      imageIds.map(async (id) => {
        const image = await drive.readImage(id);
        if (!image) throw createHttpError(Status.NotFound, `image not found: ${id}`);
        return image.data;
      }),
    );
    ctx.response.body = { text: await recognizeText(accessToken, images) };
  });

/** POST /api/shutdown  レスポンスを返してからサーバーを終了する */
const shutdownRouter = ({ onShutdown }: ApiDeps) =>
  new Router().post("/api/shutdown", (ctx) => {
    ctx.response.type = "text/plain";
    ctx.response.body = "ok";
    setTimeout(onShutdown, 100);
  });

/** /api 以下を扱う Oak アプリケーション */
export const createApiApp = (deps: ApiDeps): Application => {
  const app = new Application();

  // 例外を JSON のエラーレスポンスに変換する
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      const status = isHttpError(err) ? err.status : Status.InternalServerError;
      if (status >= 500) console.error("[api]", err);
      ctx.response.status = status;
      ctx.response.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  for (const router of [
    folderRouter(deps),
    imageRouter(deps),
    googleAuthRouter(deps),
    ocrRouter(deps),
    shutdownRouter(deps),
  ]) {
    app.use(router.routes(), router.allowedMethods());
  }

  // どのルートにも一致しなかった場合も JSON で返す
  app.use((ctx) => {
    ctx.response.status = Status.NotFound;
    ctx.response.body = { error: "not found" };
  });

  return app;
};
