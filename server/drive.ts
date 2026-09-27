import { randomBytes } from "node:crypto";
import { base64url, ensureOk, GoogleApiError } from "./google.ts";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

/** Google Drive REST API v3 の最小限のクライアント */
export class DriveClient {
  constructor(private getAccessToken: () => Promise<string>) {}

  private async request(url: string, init: RequestInit, context: string): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await this.getAccessToken()}`);
    return ensureOk(await fetch(url, { ...init, headers }), context);
  }

  async createFolder(name: string, parentId?: string): Promise<string> {
    const res = await this.request(
      `${DRIVE_API}/files?fields=id`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          mimeType: FOLDER_MIME_TYPE,
          ...(parentId ? { parents: [parentId] } : {}),
        }),
      },
      "create folder",
    );
    return ((await res.json()) as { id: string }).id;
  }

  /** ファイルが存在し、ゴミ箱に入っていないか */
  async exists(fileId: string): Promise<boolean> {
    try {
      const res = await this.request(`${DRIVE_API}/files/${fileId}?fields=trashed`, {}, "get file");
      return !((await res.json()) as { trashed: boolean }).trashed;
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 404) return false;
      throw err;
    }
  }

  async uploadFile(
    name: string,
    parentId: string,
    mimeType: string,
    data: Uint8Array,
  ): Promise<string> {
    const boundary = `snapread-${base64url(randomBytes(12))}`;
    const metadata = JSON.stringify({ name, parents: [parentId] });
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
          `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await this.request(
      `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id`,
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
      "upload file",
    );
    return ((await res.json()) as { id: string }).id;
  }

  async download(fileId: string): Promise<Uint8Array> {
    const res = await this.request(`${DRIVE_API}/files/${fileId}?alt=media`, {}, "download file");
    return new Uint8Array(await res.arrayBuffer());
  }

  async rename(fileId: string, name: string): Promise<void> {
    await this.request(
      `${DRIVE_API}/files/${fileId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
      "rename file",
    );
  }

  /** ゴミ箱へ移動する（完全削除はしない）。既に存在しない場合は何もしない */
  async trash(fileId: string): Promise<void> {
    try {
      await this.request(
        `${DRIVE_API}/files/${fileId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trashed: true }),
        },
        "trash file",
      );
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 404) return;
      throw err;
    }
  }
}
