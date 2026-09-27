import React, { useState } from "react";
import { Folder as FolderIcon, FolderPlus, Loader2, X } from "lucide-react";
import type { Folder } from "../types.ts";

interface FolderBarProps {
  folders: Folder[];
  activeFolderId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export const FolderBar: React.FC<FolderBarProps> = ({
  folders,
  activeFolderId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const startEditing = (folder: Folder) => {
    setEditingId(folder.id);
    setDraftName(folder.name);
  };

  const commitEditing = () => {
    if (editingId) {
      onRename(editingId, draftName);
    }
    setEditingId(null);
  };

  const handleDelete = (folder: Folder) => {
    if (
      folder.items.length > 0 &&
      !globalThis.confirm(
        `「${folder.name}」を削除しますか？\n画像 ${folder.items.length} 枚と解析結果も削除されます。`,
      )
    ) {
      return;
    }
    onDelete(folder.id);
  };

  return (
    <div className="h-10 bg-slate-900/90 border-b border-slate-800 px-2 flex items-center gap-1 shrink-0 select-none overflow-x-auto scrollbar-thin">
      {folders.map((folder) => {
        const isActive = folder.id === activeFolderId;
        const isBusy = folder.isChatLoading || folder.isOcrLoading;

        if (folder.id === editingId) {
          return (
            <input
              key={folder.id}
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- 名前変更開始直後に入力できるようにする
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitEditing}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEditing();
                if (e.key === "Escape") setEditingId(null);
              }}
              aria-label="フォルダ名"
              className="shrink-0 w-32 h-7 px-2 rounded-md bg-slate-950 border border-indigo-500 text-xs text-white outline-none"
            />
          );
        }

        return (
          <div
            key={folder.id}
            className={`group relative shrink-0 flex items-center h-7 rounded-md border transition-colors ${
              isActive
                ? "bg-indigo-600/20 border-indigo-500/60 text-indigo-100"
                : "bg-transparent border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <button
              type="button"
              aria-pressed={isActive}
              onClick={() => onSelect(folder.id)}
              onDoubleClick={() => startEditing(folder)}
              title="クリックで切り替え / ダブルクリックで名前を変更"
              className="flex items-center gap-1.5 h-full pl-2 pr-6 text-xs cursor-pointer"
            >
              {isBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
              ) : (
                <FolderIcon className="w-3.5 h-3.5" />
              )}
              <span className="max-w-28 truncate">{folder.name}</span>
              <span className="text-[10px] font-mono text-slate-500">{folder.items.length}</span>
            </button>

            <button
              type="button"
              onClick={() => handleDelete(folder)}
              title="フォルダを削除"
              className="absolute right-1 p-0.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onAdd}
        title="新しいフォルダを作成"
        className="shrink-0 flex items-center gap-1 h-7 px-2 rounded-md text-xs text-slate-400 hover:text-indigo-300 hover:bg-slate-800 transition-colors cursor-pointer"
      >
        <FolderPlus className="w-3.5 h-3.5" />
        <span>新規</span>
      </button>
    </div>
  );
};
