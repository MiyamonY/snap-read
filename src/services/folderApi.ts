import type { FolderPatch, StoredFolder } from "../types.ts";

const API_BASE = "/api/folders";

const ensureOk = async (res: Response): Promise<Response> => {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res;
};

export const folderApi = {
  async list(): Promise<StoredFolder[]> {
    const res = await ensureOk(await fetch(API_BASE));
    return (await res.json()) as StoredFolder[];
  },

  async save(patch: FolderPatch): Promise<void> {
    await ensureOk(
      await fetch(`${API_BASE}/${encodeURIComponent(patch.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    );
  },

  async remove(id: string): Promise<void> {
    await ensureOk(await fetch(`${API_BASE}/${encodeURIComponent(id)}`, { method: "DELETE" }));
  },
};
