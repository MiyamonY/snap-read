import { useEffect, useRef, useState } from "react";
import { folderApi } from "../services/folderApi.ts";
import type { Folder, FolderPatch, StoredFolder } from "../types.ts";
import { errorMessage } from "../utils.ts";

const FOLDER_NAME_PREFIX = "フォルダ";
const SAVE_DEBOUNCE_MS = 300;

const createFolder = (name: string): Folder => ({
  id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  name,
  createdAt: Date.now(),
  items: [],
  selectedId: null,
  ocrText: "",
  isOcrLoading: false,
  messages: [],
  isChatLoading: false,
});

const fromStored = (stored: StoredFolder): Folder => ({
  id: stored.id,
  name: stored.name,
  createdAt: stored.createdAt,
  items: stored.items,
  selectedId: stored.selectedId,
  ocrText: stored.ocrText,
  isOcrLoading: false,
  messages: stored.messages,
  isChatLoading: false,
  interactionId: stored.interactionId,
});

/** 既存のフォルダ名と重複しない「フォルダ N」を返す */
const nextFolderName = (folders: Folder[]): string => {
  const names = new Set(folders.map((f) => f.name));
  let n = 1;
  while (names.has(`${FOLDER_NAME_PREFIX} ${n}`)) n++;
  return `${FOLDER_NAME_PREFIX} ${n}`;
};

interface FoldersState {
  folders: Folder[];
  activeFolderId: string | null;
  isLoaded: boolean;
}

interface DirtyFlags {
  items: boolean;
  messages: boolean;
}

/**
 * 画像・OCR結果・チャット履歴をフォルダ単位で複数保持し、SQLite（/api/folders）と同期する
 */
export const useFolders = () => {
  const [state, setState] = useState<FoldersState>({
    folders: [],
    activeFolderId: null,
    isLoaded: false,
  });
  const [storageError, setStorageError] = useState<string | null>(null);

  // 最後に保存（または読み込み）した時点のフォルダ。参照比較で変更を検出する
  const syncedRef = useRef(new Map<string, Folder>());
  const dirtyRef = useRef(new Map<string, DirtyFlags>());
  const latestFoldersRef = useRef<Folder[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 初回読み込み
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let folders: Folder[] = [];
      try {
        folders = (await folderApi.list()).map((stored) => fromStored(stored));
        for (const f of folders) syncedRef.current.set(f.id, f);
      } catch (err) {
        console.error("Failed to load folders:", err);
        setStorageError(`フォルダの読み込みに失敗しました: ${errorMessage(err)}`);
      }
      if (cancelled) return;
      if (folders.length === 0) {
        folders = [createFolder(`${FOLDER_NAME_PREFIX} 1`)];
      }
      setState({ folders, activeFolderId: folders[0].id, isLoaded: true });
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // 変更のあったフォルダを検出してデバウンス保存・削除する
  useEffect(() => {
    if (!state.isLoaded) return;
    latestFoldersRef.current = state.folders;

    const flush = async () => {
      const dirty = [...dirtyRef.current];
      dirtyRef.current.clear();
      const folders = latestFoldersRef.current;
      await Promise.all(
        dirty.map(async ([id, flags]) => {
          const sortOrder = folders.findIndex((f) => f.id === id);
          if (sortOrder === -1) return;
          const folder = folders[sortOrder];
          const patch: FolderPatch = {
            id: folder.id,
            name: folder.name,
            createdAt: folder.createdAt,
            sortOrder,
            selectedId: folder.selectedId,
            ocrText: folder.ocrText,
            interactionId: folder.interactionId,
            ...(flags.items ? { items: folder.items } : {}),
            ...(flags.messages ? { messages: folder.messages } : {}),
          };
          try {
            await folderApi.save(patch);
            setStorageError(null);
          } catch (err) {
            console.error("Failed to save folder:", err);
            setStorageError(`フォルダの保存に失敗しました: ${errorMessage(err)}`);
          }
        }),
      );
    };

    const synced = syncedRef.current;
    let hasDirty = false;
    for (const folder of state.folders) {
      const prev = synced.get(folder.id);
      if (prev === folder) continue;
      const flags = dirtyRef.current.get(folder.id);
      dirtyRef.current.set(folder.id, {
        items: (flags?.items ?? false) || prev?.items !== folder.items,
        messages: (flags?.messages ?? false) || prev?.messages !== folder.messages,
      });
      synced.set(folder.id, folder);
      hasDirty = true;
    }

    const currentIds = new Set(state.folders.map((f) => f.id));
    for (const id of synced.keys()) {
      if (currentIds.has(id)) continue;
      synced.delete(id);
      dirtyRef.current.delete(id);
      folderApi.remove(id).catch((err: unknown) => {
        console.error("Failed to delete folder:", err);
        setStorageError(`フォルダの削除に失敗しました: ${errorMessage(err)}`);
      });
    }

    if (hasDirty) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    }
  }, [state.folders, state.isLoaded]);

  const activeFolder =
    state.folders.find((f) => f.id === state.activeFolderId) ?? state.folders.at(0);

  /** 指定フォルダを更新する（非同期処理の完了時にも、開始時のフォルダへ確実に反映される） */
  const updateFolder = (id: string, updater: (folder: Folder) => Folder) => {
    setState((prev) => ({
      ...prev,
      folders: prev.folders.map((f) => (f.id === id ? updater(f) : f)),
    }));
  };

  const addFolder = () => {
    setState((prev) => {
      const folder = createFolder(nextFolderName(prev.folders));
      return { ...prev, folders: [...prev.folders, folder], activeFolderId: folder.id };
    });
  };

  const selectFolder = (id: string) => {
    setState((prev) => ({ ...prev, activeFolderId: id }));
  };

  const renameFolder = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    updateFolder(id, (f) => ({ ...f, name: trimmed }));
  };

  /** フォルダを削除する。最後の1つを消した場合は空のフォルダを作り直す */
  const deleteFolder = (id: string) => {
    setState((prev) => {
      const index = prev.folders.findIndex((f) => f.id === id);
      const remaining = prev.folders.filter((f) => f.id !== id);
      if (remaining.length === 0) {
        const fresh = createFolder(`${FOLDER_NAME_PREFIX} 1`);
        return { ...prev, folders: [fresh], activeFolderId: fresh.id };
      }
      const activeFolderId =
        prev.activeFolderId === id
          ? remaining[Math.min(index, remaining.length - 1)].id
          : prev.activeFolderId;
      return { ...prev, folders: remaining, activeFolderId };
    });
  };

  return {
    folders: state.folders,
    activeFolder,
    isLoaded: state.isLoaded,
    storageError,
    updateFolder,
    addFolder,
    selectFolder,
    renameFolder,
    deleteFolder,
  };
};
