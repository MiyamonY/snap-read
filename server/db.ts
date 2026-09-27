import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AnalysisPreset,
  CaptureItem,
  ChatMessage,
  FolderPatch,
  SourceMode,
  StoredFolder,
} from "../src/types.ts";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS folders (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  sort_order        INTEGER NOT NULL,
  selected_id       TEXT,
  ocr_text          TEXT NOT NULL DEFAULT '',
  interaction_id    TEXT,
  -- Google ドライブ上の対応フォルダ（未作成なら NULL）と、その時点の名前
  drive_folder_id   TEXT,
  drive_folder_name TEXT
);

-- 画像の実体はローカルキャッシュと Google ドライブに置き、ここではパスと ID のみ保持する
CREATE TABLE IF NOT EXISTS images (
  id            TEXT PRIMARY KEY,
  folder_id     TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  cache_path    TEXT NOT NULL,
  drive_path    TEXT,
  drive_file_id TEXT,
  -- 一度でもフォルダの画像として保存されたか（未参照の画像の掃除に使う）
  attached      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS images_folder ON images(folder_id);

CREATE TABLE IF NOT EXISTS items (
  id               TEXT PRIMARY KEY,
  folder_id        TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL,
  image_id         TEXT NOT NULL,
  cropped_image_id TEXT,
  source           TEXT NOT NULL,
  timestamp        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_folder ON items(folder_id, position);

CREATE TABLE IF NOT EXISTS messages (
  id        TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  role      TEXT NOT NULL,
  text      TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  preset    TEXT
);
CREATE INDEX IF NOT EXISTS messages_folder ON messages(folder_id, position);

-- Google ドライブ上でゴミ箱へ移動する必要があるファイル・フォルダ
CREATE TABLE IF NOT EXISTS drive_trash_queue (
  drive_file_id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

interface FolderRow {
  id: string;
  name: string;
  created_at: number;
  sort_order: number;
  selected_id: string | null;
  ocr_text: string;
  interaction_id: string | null;
  drive_folder_id: string | null;
  drive_folder_name: string | null;
}

export interface ImageRow {
  id: string;
  folder_id: string;
  mime_type: string;
  cache_path: string;
  drive_path: string | null;
  drive_file_id: string | null;
  attached: number;
  created_at: number;
}

interface ItemRow {
  id: string;
  folder_id: string;
  image_id: string;
  cropped_image_id: string | null;
  source: string;
  timestamp: number;
}

interface MessageRow {
  id: string;
  folder_id: string;
  role: string;
  text: string;
  timestamp: number;
  preset: string | null;
}

export interface DriveFolderRow {
  id: string;
  name: string;
  drive_folder_id: string | null;
  drive_folder_name: string | null;
}

const toItem = (row: ItemRow): CaptureItem => ({
  id: row.id,
  imageId: row.image_id,
  croppedImageId: row.cropped_image_id ?? undefined,
  source: row.source as SourceMode,
  timestamp: row.timestamp,
});

const toMessage = (row: MessageRow): ChatMessage => ({
  id: row.id,
  role: row.role as ChatMessage["role"],
  text: row.text,
  timestamp: row.timestamp,
  preset: (row.preset ?? undefined) as AnalysisPreset | undefined,
});

/**
 * フォルダ・画像のパス・チャット履歴・設定を保持する SQLite ストア
 */
export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ---- folders ----

  listFolders(): StoredFolder[] {
    const folders = this.all<FolderRow>("SELECT * FROM folders ORDER BY sort_order, created_at");
    const items = this.all<ItemRow>("SELECT * FROM items ORDER BY position");
    const messages = this.all<MessageRow>("SELECT * FROM messages ORDER BY position");

    return folders.map((f) => ({
      id: f.id,
      name: f.name,
      createdAt: f.created_at,
      sortOrder: f.sort_order,
      selectedId: f.selected_id,
      ocrText: f.ocr_text,
      interactionId: f.interaction_id ?? undefined,
      items: items.filter((i) => i.folder_id === f.id).map((row) => toItem(row)),
      messages: messages.filter((m) => m.folder_id === f.id).map((row) => toMessage(row)),
    }));
  }

  /**
   * フォルダのメタ情報を upsert し、指定があれば画像・メッセージを丸ごと置き換える。
   * 置き換えで参照されなくなった画像は削除し、その画像レコードを返す（実ファイルの削除は呼び出し側）
   */
  saveFolder(patch: FolderPatch): ImageRow[] {
    return this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO folders (id, name, created_at, sort_order, selected_id, ocr_text, interaction_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             sort_order = excluded.sort_order,
             selected_id = excluded.selected_id,
             ocr_text = excluded.ocr_text,
             interaction_id = excluded.interaction_id`,
        )
        .run(
          patch.id,
          patch.name,
          patch.createdAt,
          patch.sortOrder,
          patch.selectedId,
          patch.ocrText,
          patch.interactionId ?? null,
        );

      let removedImages: ImageRow[] = [];
      if (patch.items) {
        this.db.prepare("DELETE FROM items WHERE folder_id = ?").run(patch.id);
        const insert = this.db.prepare(
          `INSERT INTO items (id, folder_id, position, image_id, cropped_image_id, source, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        const attach = this.db.prepare("UPDATE images SET attached = 1 WHERE id = ?");
        for (const [position, item] of patch.items.entries()) {
          insert.run(
            item.id,
            patch.id,
            position,
            item.imageId,
            item.croppedImageId ?? null,
            item.source,
            item.timestamp,
          );
          attach.run(item.imageId);
          if (item.croppedImageId) attach.run(item.croppedImageId);
        }

        removedImages = this.all<ImageRow>(
          `SELECT * FROM images
           WHERE folder_id = ? AND attached = 1
             AND id NOT IN (SELECT image_id FROM items WHERE folder_id = ?)
             AND id NOT IN (SELECT cropped_image_id FROM items
                            WHERE folder_id = ? AND cropped_image_id IS NOT NULL)`,
          patch.id,
          patch.id,
          patch.id,
        );
        this.removeImages(removedImages);
      }

      if (patch.messages) {
        this.db.prepare("DELETE FROM messages WHERE folder_id = ?").run(patch.id);
        const insert = this.db.prepare(
          `INSERT INTO messages (id, folder_id, position, role, text, timestamp, preset)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const [position, msg] of patch.messages.entries()) {
          insert.run(
            msg.id,
            patch.id,
            position,
            msg.role,
            msg.text,
            msg.timestamp,
            msg.preset ?? null,
          );
        }
      }

      return removedImages;
    });
  }

  /** フォルダを削除し、属していた画像レコードを返す（実ファイルの削除は呼び出し側） */
  deleteFolder(id: string): ImageRow[] {
    return this.transaction(() => {
      const folder = this.get<FolderRow>("SELECT * FROM folders WHERE id = ?", id);
      const images = this.all<ImageRow>("SELECT * FROM images WHERE folder_id = ?", id);
      this.removeImages(images);
      if (folder?.drive_folder_id) {
        this.enqueueDriveTrash(folder.drive_folder_id);
      }
      this.db.prepare("DELETE FROM folders WHERE id = ?").run(id);
      return images;
    });
  }

  /** Google ドライブ上のフォルダとの同期が必要なフォルダ（未作成・名前変更あり） */
  listFoldersNeedingDriveSync(): DriveFolderRow[] {
    return this.all<DriveFolderRow>(
      `SELECT id, name, drive_folder_id, drive_folder_name FROM folders
       WHERE drive_folder_id IS NOT NULL AND drive_folder_name IS NOT name`,
    );
  }

  getDriveFolder(folderId: string): DriveFolderRow | undefined {
    return this.get<DriveFolderRow>(
      "SELECT id, name, drive_folder_id, drive_folder_name FROM folders WHERE id = ?",
      folderId,
    );
  }

  setDriveFolder(folderId: string, driveFolderId: string | null, name: string | null): void {
    this.db
      .prepare("UPDATE folders SET drive_folder_id = ?, drive_folder_name = ? WHERE id = ?")
      .run(driveFolderId, name, folderId);
  }

  // ---- images ----

  insertImage(image: Omit<ImageRow, "attached" | "drive_path" | "drive_file_id">): void {
    this.db
      .prepare(
        `INSERT INTO images (id, folder_id, mime_type, cache_path, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(image.id, image.folder_id, image.mime_type, image.cache_path, image.created_at);
  }

  getImage(id: string): ImageRow | undefined {
    return this.get<ImageRow>("SELECT * FROM images WHERE id = ?", id);
  }

  /** まだ Google ドライブにアップロードしていない画像（フォルダが存在するもののみ） */
  listImagesPendingUpload(): ImageRow[] {
    return this.all<ImageRow>(
      `SELECT images.* FROM images JOIN folders ON folders.id = images.folder_id
       WHERE images.drive_file_id IS NULL ORDER BY images.created_at`,
    );
  }

  /** 画像が既に削除されていた場合は false を返す */
  setImageDriveFile(id: string, driveFileId: string, drivePath: string): boolean {
    const { changes } = this.db
      .prepare("UPDATE images SET drive_file_id = ?, drive_path = ? WHERE id = ?")
      .run(driveFileId, drivePath, id);
    return Number(changes) > 0;
  }

  /** フォルダ名の変更に合わせて、そのフォルダの画像のドライブ上のパスを更新する */
  renameImageDrivePaths(folderId: string, oldPrefix: string, newPrefix: string): void {
    this.db
      .prepare(
        `UPDATE images SET drive_path = ? || substr(drive_path, ?)
         WHERE folder_id = ? AND drive_path LIKE ? || '%'`,
      )
      .run(newPrefix, oldPrefix.length + 1, folderId, oldPrefix);
  }

  /** アップロードされたまま一定時間フォルダに保存されなかった画像を削除し、そのレコードを返す */
  deleteStaleUnattachedImages(olderThan: number): ImageRow[] {
    return this.transaction(() => {
      const images = this.all<ImageRow>(
        "SELECT * FROM images WHERE attached = 0 AND created_at < ?",
        olderThan,
      );
      this.removeImages(images);
      return images;
    });
  }

  // ---- drive trash queue ----

  listDriveTrashQueue(): string[] {
    return this.all<{ drive_file_id: string }>("SELECT drive_file_id FROM drive_trash_queue").map(
      (r) => r.drive_file_id,
    );
  }

  dequeueDriveTrash(driveFileId: string): void {
    this.db.prepare("DELETE FROM drive_trash_queue WHERE drive_file_id = ?").run(driveFileId);
  }

  // ---- settings ----

  getSetting(key: string): string | undefined {
    return this.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key)?.value;
  }

  setSetting(key: string, value: string | null): void {
    if (value === null) {
      this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
      return;
    }
    this.db
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  // ---- helpers ----

  private removeImages(images: ImageRow[]): void {
    const remove = this.db.prepare("DELETE FROM images WHERE id = ?");
    for (const image of images) {
      remove.run(image.id);
      if (image.drive_file_id) this.enqueueDriveTrash(image.drive_file_id);
    }
  }

  private enqueueDriveTrash(driveFileId: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO drive_trash_queue (drive_file_id) VALUES (?)")
      .run(driveFileId);
  }

  private all<T>(sql: string, ...params: (string | number)[]): T[] {
    return this.db.prepare(sql).all(...params) as unknown as T[];
  }

  private get<T>(sql: string, ...params: (string | number)[]): T | undefined {
    return this.db.prepare(sql).get(...params) as unknown as T | undefined;
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}
