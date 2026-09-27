import React from "react";
import { BookMarked, Folder as FolderIcon, Loader2, Trash2 } from "lucide-react";
import type { VocabularyEntry } from "../types.ts";

interface VocabularyListProps {
  words: VocabularyEntry[];
  isLoading: boolean;
  error: string | null;
  onRemove: (word: string) => void;
  onSelectFolder: (folderId: string) => void;
}

export const VocabularyList: React.FC<VocabularyListProps> = ({
  words,
  isLoading,
  error,
  onRemove,
  onSelectFolder,
}) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 h-full text-xs text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
        <span>単語帳を読み込んでいます...</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      {error && (
        <div className="px-3 py-2 rounded-lg bg-rose-950/60 border border-rose-900 text-xs text-rose-200">
          ⚠️ {error}
        </div>
      )}

      {words.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-slate-400">
          <BookMarked className="w-8 h-8 text-slate-600" />
          <p className="text-sm">このフォルダの単語帳はまだ空です</p>
          <p className="text-xs text-slate-500">
            テキストリーダーで単語をクリックし、「単語帳に追加」で登録できます
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {words.map((entry) => (
            <li
              key={entry.word}
              className="group rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-bold text-white">{entry.word}</span>
                  {entry.phonetic && (
                    <span className="text-[10px] font-mono text-slate-400">/{entry.phonetic}/</span>
                  )}
                  <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold px-1.5 py-0.5 rounded">
                    {entry.partOfSpeech}
                  </span>
                  <span className="text-sm text-slate-100">{entry.meaning}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(entry.word)}
                  title="単語帳から削除"
                  className="shrink-0 p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {entry.detail && (
                <p className="text-[11px] text-slate-300 leading-relaxed">{entry.detail}</p>
              )}
              {entry.context && (
                <p className="text-[11px] text-slate-500 italic leading-relaxed border-l-2 border-slate-700 pl-2">
                  {entry.context}
                </p>
              )}

              {entry.otherFolders.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 pt-0.5 text-[10px] text-slate-500">
                  <span>他のフォルダ:</span>
                  {entry.otherFolders.map((folder) => (
                    <button
                      type="button"
                      key={folder.id}
                      onClick={() => onSelectFolder(folder.id)}
                      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                    >
                      <FolderIcon className="w-2.5 h-2.5" />
                      {folder.name}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
