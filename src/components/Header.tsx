import React from "react";
import { BookMarked, BookOpen, Key, Sparkles, X } from "lucide-react";
import type { MainTab } from "../types.ts";
import { DriveButton } from "./DriveButton.tsx";

interface HeaderProps {
  activeTab: MainTab;
  onChangeTab: (tab: MainTab) => void;
  hasOcrText: boolean;
  vocabularyCount: number;
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

const tabClass = (active: boolean) =>
  `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
    active
      ? "bg-indigo-600 text-white shadow-sm"
      : "text-slate-300 hover:text-white hover:bg-slate-800/60"
  }`;

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onChangeTab,
  hasOcrText,
  vocabularyCount,
  onOpenSettings,
  hasApiKey,
}) => {
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

      {/* Main View Tabs */}
      <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800/80 space-x-1">
        <button
          type="button"
          onClick={() => onChangeTab("reader")}
          className={tabClass(activeTab === "reader")}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>📖 テキスト読解 & 辞書</span>
          {hasOcrText && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
          )}
        </button>
        <button
          type="button"
          onClick={() => onChangeTab("vocab")}
          className={tabClass(activeTab === "vocab")}
        >
          <BookMarked className="w-3.5 h-3.5" />
          <span>単語帳</span>
          {vocabularyCount > 0 && (
            <span className="text-[10px] px-1 py-0.2 rounded-full bg-emerald-500/30 text-emerald-200 font-mono">
              {vocabularyCount}
            </span>
          )}
        </button>
      </div>

      {/* Right Controls: Settings & Window Close */}
      <div className="flex items-center space-x-2">
        <DriveButton />
        <button
          type="button"
          onClick={onOpenSettings}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
            hasApiKey
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
              : "border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 animate-pulse"
          }`}
          title="OpenAI APIキーの設定"
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
