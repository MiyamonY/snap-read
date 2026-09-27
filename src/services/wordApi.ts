import type { VocabularyEntry, VocabularyInput } from "../types.ts";

const wordsUrl = (folderId: string, word?: string) =>
  `/api/folders/${encodeURIComponent(folderId)}/words${word ? `/${encodeURIComponent(word)}` : ""}`;

const ensureOk = async (res: Response): Promise<Response> => {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res;
};

export const wordApi = {
  async list(folderId: string): Promise<VocabularyEntry[]> {
    const res = await ensureOk(await fetch(wordsUrl(folderId)));
    return (await res.json()) as VocabularyEntry[];
  },

  async save(folderId: string, word: string, input: VocabularyInput): Promise<void> {
    await ensureOk(
      await fetch(wordsUrl(folderId, word), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  },

  async remove(folderId: string, word: string): Promise<void> {
    await ensureOk(await fetch(wordsUrl(folderId, word), { method: "DELETE" }));
  },
};
