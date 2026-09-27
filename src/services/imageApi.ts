import type { CaptureItem } from "../types.ts";

const API_BASE = "/api/images";

export const imageUrl = (imageId: string) => `${API_BASE}/${encodeURIComponent(imageId)}`;

/** 表示・解析に使う画像（切り抜き済みならそちら）の URL */
export const itemImageUrl = (item: CaptureItem) => imageUrl(item.croppedImageId ?? item.imageId);

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as string));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("read failed")));
    reader.readAsDataURL(blob);
  });

const ensureOk = async (res: Response): Promise<Response> => {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res;
};

export const imageApi = {
  /** 画像を保存して画像 ID を返す（サーバーがローカル保存後、Google ドライブへ同期する） */
  async upload(folderId: string, image: Blob): Promise<string> {
    const res = await ensureOk(
      await fetch(`${API_BASE}?folderId=${encodeURIComponent(folderId)}`, {
        method: "POST",
        headers: { "Content-Type": image.type },
        body: image,
      }),
    );
    return ((await res.json()) as { id: string }).id;
  },

  async uploadDataUrl(folderId: string, dataUrl: string): Promise<string> {
    return imageApi.upload(folderId, await (await fetch(dataUrl)).blob());
  },

  /** Gemini へ送るため、保存済みの画像を data URL として取得する */
  async fetchAsDataUrl(url: string): Promise<string> {
    return blobToDataUrl(await (await ensureOk(await fetch(url))).blob());
  },
};
