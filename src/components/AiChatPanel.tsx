import React, { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  Copy,
  FileText,
  HelpCircle,
  Languages,
  Loader2,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import type { AnalysisPreset, CaptureItem, ChatMessage } from "../types.ts";
import { MODEL_LABEL, PRESET_PROMPTS } from "../services/ai.ts";

const renderFormattedInline = (text: string) => {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/gu);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-indigo-200">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="bg-slate-800 text-indigo-300 px-1 py-0.5 rounded text-[11px] font-mono"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
};

const renderMarkdown = (content: string) => {
  const lines = content.split("\n");
  return lines.map((line, idx) => {
    if (line.startsWith("### ")) {
      return (
        <h3
          key={idx}
          className="text-sm font-bold text-indigo-300 mt-4 mb-1.5 flex items-center gap-1.5"
        >
          {line.replace("### ", "")}
        </h3>
      );
    }
    if (line.startsWith("## ")) {
      return (
        <h2
          key={idx}
          className="text-base font-bold text-white mt-4 mb-2 pb-1 border-b border-slate-700/60"
        >
          {line.replace("## ", "")}
        </h2>
      );
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const itemText = line.slice(2);
      return (
        <li key={idx} className="ml-4 list-disc text-slate-200 my-1 pl-1 text-xs leading-relaxed">
          {renderFormattedInline(itemText)}
        </li>
      );
    }
    if (line.trim() === "") {
      return <div key={idx} className="h-2" />;
    }
    return (
      <p key={idx} className="text-xs text-slate-200 leading-relaxed my-1">
        {renderFormattedInline(line)}
      </p>
    );
  });
};

const POSITION_STORAGE_KEY = "snapread_ai_dialog_position";

interface DialogPosition {
  left: number;
  top: number;
}

const loadPosition = (): DialogPosition | null => {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_STORAGE_KEY) ?? "null") as unknown;
    if (
      saved &&
      typeof (saved as DialogPosition).left === "number" &&
      typeof (saved as DialogPosition).top === "number"
    ) {
      return saved as DialogPosition;
    }
  } catch {
    // 壊れた値は無視して既定の位置（右下）に表示する
  }
  return null;
};

/** ダイアログが表示領域（offsetParent）からはみ出さないように位置を収める */
const clampPosition = (position: DialogPosition, dialog: HTMLElement): DialogPosition => {
  const parent = dialog.offsetParent as HTMLElement | null;
  if (!parent) return position;
  return {
    left: Math.min(
      Math.max(0, position.left),
      Math.max(0, parent.clientWidth - dialog.offsetWidth),
    ),
    top: Math.min(
      Math.max(0, position.top),
      Math.max(0, parent.clientHeight - dialog.offsetHeight),
    ),
  };
};

interface AiChatPanelProps {
  items: CaptureItem[];
  messages: ChatMessage[];
  isLoading: boolean;
  onExecutePreset: (preset: AnalysisPreset, prompt: string) => void;
  onSendMessage: (text: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

/** AI 解説（プリセット解析）とチャット。本文の上に浮かぶチャットダイアログとして表示する */
export const AiChatPanel: React.FC<AiChatPanelProps> = ({
  items,
  messages,
  isLoading,
  onExecutePreset,
  onSendMessage,
  isOpen,
  onToggle,
}) => {
  const [inputText, setInputText] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hasImages = items.length > 0;

  // ドラッグで移動した位置（未移動なら null で右下に表示）
  const [position, setPosition] = useState<DialogPosition | null>(loadPosition);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const dragRef = useRef<{ pointerX: number; pointerY: number; origin: DialogPosition } | null>(
    null,
  );

  // ウィンドウサイズが変わっても表示領域に収まるようにする
  useEffect(() => {
    const handleResize = () => {
      const dialog = dialogRef.current;
      if (dialog) setPosition((prev) => prev && clampPosition(prev, dialog));
    };
    globalThis.addEventListener("resize", handleResize);
    return () => globalThis.removeEventListener("resize", handleResize);
  }, []);

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const dialog = dialogRef.current;
    if (!dialog || (e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      origin: { left: dialog.offsetLeft, top: dialog.offsetTop },
    };
  };

  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const dialog = dialogRef.current;
    if (!drag || !dialog) return;
    setPosition(
      clampPosition(
        {
          left: drag.origin.left + e.clientX - drag.pointerX,
          top: drag.origin.top + e.clientY - drag.pointerY,
        },
        dialog,
      ),
    );
  };

  const handleDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const dialog = dialogRef.current;
    if (dialog) {
      localStorage.setItem(
        POSITION_STORAGE_KEY,
        JSON.stringify({ left: dialog.offsetLeft, top: dialog.offsetTop }),
      );
    }
  };

  /** 既定の位置（右下）に戻す */
  const resetPosition = () => {
    setPosition(null);
    localStorage.removeItem(POSITION_STORAGE_KEY);
  };

  // Auto scroll to the latest message
  useEffect(() => {
    if (scrollRef.current && isOpen) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    // messages / isLoading はスクロールのトリガーとして意図的に依存に含めている
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [messages, isLoading, isOpen]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    onSendMessage(inputText.trim());
    setInputText("");
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1500);
  };

  const badge = messages.length > 0 && (
    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/20 text-white font-mono">
      {messages.length}
    </span>
  );

  // Closed: floating launcher button
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="absolute bottom-5 right-5 z-40 flex items-center gap-2 pl-3.5 pr-4 py-2.5 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white text-xs font-medium shadow-xl shadow-indigo-900/50 transition-all hover:scale-105 cursor-pointer"
        title="AI解説 & チャットを開く"
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Sparkles className="w-4 h-4" />
        )}
        <span>AI解説</span>
        {badge}
      </button>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      open
      style={position ?? undefined}
      aria-label="AI解説 & チャット"
      className={`absolute inset-auto ${position ? "" : "bottom-5 right-5"} m-0 p-0 text-slate-100 z-40 w-[min(440px,calc(100%-2.5rem))] h-[min(640px,calc(100%-2.5rem))] flex flex-col rounded-2xl border border-slate-700 bg-slate-900/95 backdrop-blur shadow-2xl shadow-black/60 overflow-hidden`}
    >
      {/* Header: title & close (drag to move, double-click to reset position) */}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- マウス・タッチでのドラッグ移動用のつまみ */}
      <div
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        onDoubleClick={resetPosition}
        title="ドラッグで移動（ダブルクリックで右下に戻す）"
        className="h-10 px-4 flex items-center justify-between shrink-0 cursor-move select-none touch-none bg-gradient-to-r from-indigo-600/30 to-violet-600/20 border-b border-slate-700/80 text-xs text-white"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
          <span>💡 AI解説 & チャット</span>
          {badge}
          {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-300" />}
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="p-1 rounded-md text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
          title="閉じる"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto space-y-4">
          {/* Preset Action Buttons (Shown when no messages yet) */}
          {hasImages && messages.length === 0 && (
            <div className="space-y-2">
              <span className="text-[11px] font-medium text-slate-400 block px-1">
                {items.length > 1
                  ? `全 ${items.length} 枚を一括解析するプリセット`
                  : "ワンクリック解析プリセット"}
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => onExecutePreset("translate", PRESET_PROMPTS.translate)}
                  className="flex flex-col items-start p-3 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/50 text-left transition-all group disabled:opacity-50 cursor-pointer"
                >
                  <div className="flex items-center gap-2 text-indigo-400 font-medium text-xs mb-1">
                    <Languages className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    <span>全文翻訳</span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {items.length > 1 ? `全${items.length}枚の日本語訳` : "自然な日本語訳と原文"}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => onExecutePreset("grammar", PRESET_PROMPTS.grammar)}
                  className="flex flex-col items-start p-3 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/50 text-left transition-all group disabled:opacity-50 cursor-pointer"
                >
                  <div className="flex items-center gap-2 text-sky-400 font-medium text-xs mb-1">
                    <FileText className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    <span>構文・文法解説</span>
                  </div>
                  <span className="text-[11px] text-slate-400">SVOCや関係詞の分解</span>
                </button>

                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => onExecutePreset("vocab", PRESET_PROMPTS.vocab)}
                  className="flex flex-col items-start p-3 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/50 text-left transition-all group disabled:opacity-50 cursor-pointer"
                >
                  <div className="flex items-center gap-2 text-emerald-400 font-medium text-xs mb-1">
                    <BookOpen className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    <span>重要単語・熟語</span>
                  </div>
                  <span className="text-[11px] text-slate-400">語彙・イディオムの抽出</span>
                </button>

                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => onExecutePreset("summary", PRESET_PROMPTS.summary)}
                  className="flex flex-col items-start p-3 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/50 text-left transition-all group disabled:opacity-50 cursor-pointer"
                >
                  <div className="flex items-center gap-2 text-amber-400 font-medium text-xs mb-1">
                    <HelpCircle className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    <span>要約・要点</span>
                  </div>
                  <span className="text-[11px] text-slate-400">短時間で大意を把握</span>
                </button>
              </div>
            </div>
          )}

          {/* Conversation Messages */}
          <div className="space-y-4">
            {messages.map((msg, index) => (
              <div
                key={msg.id}
                className={`rounded-xl p-3.5 border transition-all ${
                  msg.role === "user"
                    ? "bg-indigo-950/40 border-indigo-800/60 ml-6 text-indigo-100"
                    : "bg-slate-950 border-slate-800 mr-2 text-slate-200 shadow-md"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider font-semibold text-slate-400">
                    {msg.role === "user" ? "あなた" : MODEL_LABEL}
                  </span>

                  {msg.role === "model" && (
                    <button
                      type="button"
                      onClick={() => handleCopy(msg.text, index)}
                      className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors"
                      title="テキストをコピー"
                    >
                      {copiedIndex === index ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>

                <div className="prose prose-invert prose-xs max-w-none">
                  {renderMarkdown(msg.text)}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-indigo-300 animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                <span>
                  {items.length > 1
                    ? `${MODEL_LABEL}が全${items.length}枚の英文を解析中...`
                    : `${MODEL_LABEL}が英文を解析中...`}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Chat Input Form */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/80">
          <form onSubmit={handleSend} className="relative flex items-center">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={!hasImages || isLoading}
              placeholder={
                hasImages
                  ? `例: 「${items.length > 1 ? "全ページ" : "この文"}の要点は？」「日常会話での言い換えは？」`
                  : "まず画像をキャプチャしてください"
              }
              className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-4 py-2.5 pr-12 text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!hasImages || !inputText.trim() || isLoading}
              className="absolute right-2 p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white transition-all cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </dialog>
  );
};
