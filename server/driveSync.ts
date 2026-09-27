import { existsSync, mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageRow, Store } from "./db.ts";
import { DriveClient } from "./drive.ts";
import {
  createAuthRequest,
  exchangeCode,
  GoogleApiError,
  refreshAccessToken,
  revokeToken,
} from "./google.ts";
import type { GoogleOAuthConfig, TokenSet } from "./google.ts";

const ROOT_FOLDER_NAME = "SnapRead";
const SYNC_INTERVAL_MS = 60_000;
const AUTH_REQUEST_TTL_MS = 10 * 60_000;
const UNATTACHED_IMAGE_TTL_MS = 24 * 60 * 60_000;

const SETTING_REFRESH_TOKEN = "google.refresh_token";
const SETTING_EMAIL = "google.email";
const SETTING_ROOT_FOLDER_ID = "google.root_folder_id";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export interface DriveStatus {
  configured: boolean;
  connected: boolean;
  email?: string;
  pendingUploads: number;
  lastError?: string;
}

/**
 * 画像の保存（ローカルキャッシュ + Google ドライブ）と、ドライブとのバックグラウンド同期を担う
 */
export class DriveSync {
  private token: TokenSet | undefined;
  private drive: DriveClient;
  private authRequests = new Map<string, { codeVerifier: string; expiresAt: number }>();
  private verifiedDriveFolders = new Set<string>();
  private running = false;
  private rerun = false;
  private lastError: string | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private store: Store,
    private cacheDir: string,
    private oauth: GoogleOAuthConfig | undefined,
  ) {
    mkdirSync(cacheDir, { recursive: true });
    this.drive = new DriveClient(() => this.getAccessToken());
  }

  start(): void {
    this.removeImageFiles(
      this.store.deleteStaleUnattachedImages(Date.now() - UNATTACHED_IMAGE_TTL_MS),
    );
    this.timer = setInterval(() => this.kick(), SYNC_INTERVAL_MS);
    this.kick();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  // ---- auth ----

  status(): DriveStatus {
    return {
      configured: !!this.oauth,
      connected: this.isConnected(),
      email: this.store.getSetting(SETTING_EMAIL),
      pendingUploads: this.store.listImagesPendingUpload().length,
      lastError: this.lastError,
    };
  }

  /** 認可リクエストの URL を作る。未設定なら undefined */
  startLogin(): string | undefined {
    if (!this.oauth) return undefined;
    const now = Date.now();
    for (const [state, req] of this.authRequests) {
      if (req.expiresAt < now) this.authRequests.delete(state);
    }
    const { url, state, codeVerifier } = createAuthRequest(this.oauth);
    this.authRequests.set(state, { codeVerifier, expiresAt: now + AUTH_REQUEST_TTL_MS });
    return url;
  }

  async handleCallback(code: string, state: string): Promise<void> {
    const request = this.authRequests.get(state);
    this.authRequests.delete(state);
    if (!this.oauth || !request || request.expiresAt < Date.now()) {
      throw new Error("認可リクエストが無効か、期限切れです。もう一度接続してください。");
    }
    const token = await exchangeCode(this.oauth, code, request.codeVerifier);
    if (!token.refreshToken) {
      throw new Error("リフレッシュトークンを取得できませんでした。");
    }
    if (token.email && token.email !== this.store.getSetting(SETTING_EMAIL)) {
      // 別アカウントでは drive.file スコープで既存ファイルにアクセスできないため、ルートを作り直す
      this.store.setSetting(SETTING_ROOT_FOLDER_ID, null);
      this.verifiedDriveFolders.clear();
    }
    this.token = token;
    this.store.setSetting(SETTING_REFRESH_TOKEN, token.refreshToken);
    this.store.setSetting(SETTING_EMAIL, token.email ?? null);
    this.lastError = undefined;
    this.kick();
  }

  async logout(): Promise<void> {
    const refreshToken = this.store.getSetting(SETTING_REFRESH_TOKEN);
    this.disconnect();
    if (refreshToken) {
      await revokeToken(refreshToken);
    }
  }

  private isConnected(): boolean {
    return !!this.oauth && !!this.store.getSetting(SETTING_REFRESH_TOKEN);
  }

  private disconnect(): void {
    this.token = undefined;
    this.store.setSetting(SETTING_REFRESH_TOKEN, null);
    this.store.setSetting(SETTING_EMAIL, null);
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > Date.now()) {
      return this.token.accessToken;
    }
    const refreshToken = this.store.getSetting(SETTING_REFRESH_TOKEN);
    if (!this.oauth || !refreshToken) {
      throw new Error("Google ドライブに接続されていません。");
    }
    try {
      this.token = await refreshAccessToken(this.oauth, refreshToken);
    } catch (err) {
      // 失効・取り消し済みのリフレッシュトークンは破棄して再接続を促す
      if (err instanceof GoogleApiError && err.status === 400) {
        this.disconnect();
      }
      throw err;
    }
    return this.token.accessToken;
  }

  // ---- images ----

  async saveImage(folderId: string, mimeType: string, data: Uint8Array): Promise<string> {
    const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cachePath = join(this.cacheDir, `${id}.${EXTENSIONS[mimeType] ?? "bin"}`);
    await writeFile(cachePath, data);
    this.store.insertImage({
      id,
      folder_id: folderId,
      mime_type: mimeType,
      cache_path: cachePath,
      created_at: Date.now(),
    });
    this.kick();
    return id;
  }

  /** 画像を読み出す。ローカルキャッシュに無ければドライブから取得してキャッシュする */
  async readImage(id: string): Promise<{ mimeType: string; data: Uint8Array } | undefined> {
    const image = this.store.getImage(id);
    if (!image) return undefined;
    if (existsSync(image.cache_path)) {
      return { mimeType: image.mime_type, data: await readFile(image.cache_path) };
    }
    if (!image.drive_file_id || !this.isConnected()) return undefined;
    const data = await this.drive.download(image.drive_file_id);
    await writeFile(image.cache_path, data);
    return { mimeType: image.mime_type, data };
  }

  /** DB から削除済みの画像のキャッシュファイルを消し、ドライブ側の削除を同期する */
  removeImageFiles(images: ImageRow[]): void {
    for (const image of images) {
      rm(image.cache_path, { force: true }).catch((err: unknown) => {
        console.error("[drive-sync] failed to remove cache file:", err);
      });
    }
    this.kick();
  }

  // ---- sync ----

  /** 同期を開始する（実行中なら終了後にもう一度実行する） */
  kick(): void {
    if (!this.isConnected()) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    this.runSync();
  }

  private async runSync(): Promise<void> {
    try {
      await this.sync();
      this.lastError = undefined;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error("[drive-sync]", err);
    }
    this.running = false;
    if (this.rerun) {
      this.rerun = false;
      this.kick();
    }
  }

  private async sync(): Promise<void> {
    for (const fileId of this.store.listDriveTrashQueue()) {
      await this.drive.trash(fileId);
      this.store.dequeueDriveTrash(fileId);
    }

    for (const folder of this.store.listFoldersNeedingDriveSync()) {
      if (!folder.drive_folder_id) continue;
      await this.drive.rename(folder.drive_folder_id, folder.name);
      this.store.setDriveFolder(folder.id, folder.drive_folder_id, folder.name);
      if (folder.drive_folder_name) {
        this.store.renameImageDrivePaths(
          folder.id,
          `${ROOT_FOLDER_NAME}/${folder.drive_folder_name}/`,
          `${ROOT_FOLDER_NAME}/${folder.name}/`,
        );
      }
    }

    for (const image of this.store.listImagesPendingUpload()) {
      await this.uploadImage(image);
    }
  }

  private async uploadImage(image: ImageRow): Promise<void> {
    if (!existsSync(image.cache_path)) return;
    const folder = await this.ensureDriveFolder(image.folder_id);
    if (!folder) return;

    const fileName = `${image.id}.${EXTENSIONS[image.mime_type] ?? "bin"}`;
    const fileId = await this.drive.uploadFile(
      fileName,
      folder.driveFolderId,
      image.mime_type,
      await readFile(image.cache_path),
    );
    const saved = this.store.setImageDriveFile(
      image.id,
      fileId,
      `${ROOT_FOLDER_NAME}/${folder.name}/${fileName}`,
    );
    if (!saved) {
      // アップロード中に画像が削除された
      await this.drive.trash(fileId);
    }
  }

  private async ensureRootFolder(): Promise<string> {
    const rootId = this.store.getSetting(SETTING_ROOT_FOLDER_ID);
    if (rootId && (this.verifiedDriveFolders.has(rootId) || (await this.drive.exists(rootId)))) {
      this.verifiedDriveFolders.add(rootId);
      return rootId;
    }
    const newRootId = await this.drive.createFolder(ROOT_FOLDER_NAME);
    this.store.setSetting(SETTING_ROOT_FOLDER_ID, newRootId);
    this.verifiedDriveFolders.add(newRootId);
    return newRootId;
  }

  private async ensureDriveFolder(
    folderId: string,
  ): Promise<{ driveFolderId: string; name: string } | undefined> {
    const folder = this.store.getDriveFolder(folderId);
    if (!folder) return undefined;

    const current = folder.drive_folder_id;
    if (current && (this.verifiedDriveFolders.has(current) || (await this.drive.exists(current)))) {
      this.verifiedDriveFolders.add(current);
      return { driveFolderId: current, name: folder.drive_folder_name ?? folder.name };
    }

    const driveFolderId = await this.drive.createFolder(folder.name, await this.ensureRootFolder());
    this.store.setDriveFolder(folderId, driveFolderId, folder.name);
    this.verifiedDriveFolders.add(driveFolderId);
    return { driveFolderId, name: folder.name };
  }
}
