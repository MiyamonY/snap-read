import React from "react";
import { Plus, Trash2, X } from "lucide-react";
import { CaptureItem } from "../types.ts";

interface ImageTrayProps {
  items: CaptureItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onClearAll: () => void;
  onAddNew: () => void;
  isStreaming: boolean;
}

export const ImageTray: React.FC<ImageTrayProps> = ({
  items,
  selectedId,
  onSelect,
  onDelete,
  onClearAll,
  onAddNew,
  isStreaming,
}) => {
  if (items.length === 0) return null;

  return (
    <div className="h-20 bg-slate-900/90 border-t border-slate-800 px-4 flex items-center justify-between shrink-0 select-none z-10">
      {/* Left: Thumbnail Scroll List */}
      <div className="flex items-center gap-2.5 overflow-x-auto py-1 scrollbar-thin flex-1 min-w-0 pr-3">
        {items.map((item, index) => {
          const isSelected = item.id === selectedId;
          const displayUrl = item.croppedDataUrl || item.dataUrl;

          return (
            <div
              key={item.id}
              className={`relative group shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${
                isSelected
                  ? "border-indigo-500 ring-2 ring-indigo-500/40 shadow-md scale-105"
                  : "border-slate-700/80 hover:border-slate-500 opacity-75 hover:opacity-100"
              }`}
            >
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(item.id)}
                className="block w-full h-full cursor-pointer"
              >
                <img
                  src={displayUrl}
                  alt={`Captured ${index + 1}`}
                  className="w-full h-full object-cover"
                />

                {/* Number Badge */}
                <span className="absolute bottom-0.5 left-0.5 bg-black/70 text-[9px] font-mono font-bold text-white px-1 py-0.2 rounded-xs">
                  #{index + 1}
                </span>
              </button>

              {/* Delete Button on Hover */}
              <button
                onClick={(e) => onDelete(item.id, e)}
                className="absolute top-0.5 right-0.5 p-0.5 bg-black/80 hover:bg-rose-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                title="この画像を削除"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        {/* Add more button */}
        <button
          onClick={onAddNew}
          className={`shrink-0 w-14 h-14 rounded-lg border-2 border-dashed flex flex-col items-center justify-center transition-all cursor-pointer ${
            isStreaming
              ? "border-indigo-500 bg-indigo-500/10 text-indigo-400"
              : "border-slate-700 hover:border-indigo-500/60 hover:bg-slate-800 text-slate-400 hover:text-indigo-300"
          }`}
          title="さらに画像を追加キャプチャ"
        >
          <Plus className="w-4 h-4 mb-0.5" />
          <span className="text-[9px] font-medium leading-none">追加</span>
        </button>
      </div>

      {/* Right: Summary & Clear All */}
      <div className="flex items-center gap-3 shrink-0 pl-2 border-l border-slate-800">
        <div className="text-right">
          <div className="text-xs font-semibold text-slate-200">{items.length} 枚</div>
          <div className="text-[10px] text-slate-400">取り込み中</div>
        </div>

        <button
          onClick={onClearAll}
          className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
          title="すべての画像をクリア"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
