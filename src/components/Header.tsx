import React from "react";
import { Monitor, Camera, Image, Key, Sparkles, X } from "lucide-react";
import type { SourceMode } from "../types.ts";

interface HeaderProps {
  activeSource: SourceMode | "none";
  onSelectScreen: () => void;
  onSelectCamera: () => void;
  onSelectFiles: (files: FileList) => void;
  onOpenSettings: () => void;
  hasApiKey: boolean;
}

const handleCloseWindow = async () => {
  try {
    await fetch("/api/shutdown", { method: "POST" });
  } catch {
    // Ignore network errors on shutdown
  }
  window.close();
};

export const Header: React.FC<HeaderProps> = ({
  activeSource,
  onSelectScreen,
  onSelectCamera,
  onSelectFiles,
  onOpenSettings,
  hasApiKey,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onSelectFiles(e.target.files);
    }
    e.target.value = "";
  };

  return (
    <header className="h-14 border-b border-slate-800 bg-slate-900/90 backdrop-blur px-4 flex items-center justify-between shrink-0 select-none z-20">
      {/* Brand */}
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-wide text-white flex items-center gap-1.5">
            SnapRead
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
              Desktop
            </span>
          </h1>
          <p className="text-[11px] text-slate-400">リアルタイム英文キャプチャ & AI解析</p>
        </div>
      </div>

      {/* Source Selection Buttons */}
      <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800/80 space-x-1">
        <button
          type="button"
          onClick={onSelectScreen}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            activeSource === "screen"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-slate-300 hover:text-white hover:bg-slate-800/60"
          }`}
          title="デスクトップ画面やアプリウィンドウを共有"
        >
          <Monitor className="w-3.5 h-3.5" />
          <span>画面共有</span>
        </button>

        <button
          type="button"
          onClick={onSelectCamera}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            activeSource === "camera"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-slate-300 hover:text-white hover:bg-slate-800/60"
          }`}
          title="Webカメラで紙の本や書類を取り込む"
        >
          <Camera className="w-3.5 h-3.5" />
          <span>カメラ</span>
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/60 transition-all cursor-pointer"
          title="画像ファイルを選択（複数選択可）"
        >
          <Image className="w-3.5 h-3.5" />
          <span>ファイル読込</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Right Controls: Settings & Window Close */}
      <div className="flex items-center space-x-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
            hasApiKey
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
              : "border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 animate-pulse"
          }`}
          title="Gemini APIキーの設定"
        >
          <Key className="w-3.5 h-3.5" />
          <span>{hasApiKey ? "API設定済" : "APIキー設定"}</span>
        </button>

        <div className="h-4 w-px bg-slate-800 mx-1" />

        {/* Window Close Button */}
        <button
          type="button"
          onClick={handleCloseWindow}
          className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-rose-600 transition-colors cursor-pointer group"
          title="ウィンドウを閉じてアプリを終了"
          aria-label="閉じる"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
