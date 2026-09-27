import React, { useState, useRef, useEffect } from "react";
import {
  Languages,
  BookOpen,
  FileText,
  HelpCircle,
  Send,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  Loader2,
  BookMarked,
} from "lucide-react";
import type {
  AnalysisPreset,
  ChatMessage,
  CaptureItem,
  VocabularyEntry,
  VocabularyInput,
} from "../types.ts";
import { PRESET_PROMPTS } from "../services/gemini.ts";
import { itemImageUrl } from "../services/imageApi.ts";
import { InteractiveReader } from "./InteractiveReader.tsx";
import { VocabularyList } from "./VocabularyList.tsx";

export interface VocabularyProps {
  words: VocabularyEntry[];
  savedWords: Set<string>;
  isLoading: boolean;
  error: string | null;
  onSave: (word: string, input: VocabularyInput) => void;
  onRemove: (word: string) => void;
  onSelectFolder: (folderId: string) => void;
}

interface AnalysisPanelProps {
  items: CaptureItem[];
  messages: ChatMessage[];
  isLoading: boolean;
  onExecutePreset: (preset: AnalysisPreset, prompt: string) => void;
  onSendMessage: (text: string) => void;
  onReset: () => void;
  selectedId: string | null;
  onSelectImage: (id: string) => void;
  ocrText: string;
  isOcrLoading: boolean;
  onExtractOcr: () => void;
  vocabulary: VocabularyProps;
}

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

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({
  items,
  messages,
  isLoading,
  onExecutePreset,
  onSendMessage,
  onReset,
  selectedId,
  onSelectImage,
  ocrText,
  isOcrLoading,
  onExtractOcr,
  vocabulary,
}) => {
  const [activeTab, setActiveTab] = useState<"reader" | "vocab" | "ai">(() =>
    messages.length > 0 ? "ai" : "reader",
  );
  const [inputText, setInputText] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto switch to AI tab when a preset is executed or messages arrive
  const [prevMessageCount, setPrevMessageCount] = useState(messages.length);
  if (prevMessageCount !== messages.length) {
    setPrevMessageCount(messages.length);
    if (messages.length > 0) {
      setActiveTab("ai");
    }
  }

  // Auto scroll in AI view
  useEffect(() => {
    if (scrollRef.current && activeTab === "ai") {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    // messages / isLoading はスクロールのトリガーとして意図的に依存に含めている
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [messages, isLoading, activeTab]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    onSendMessage(inputText.trim());
    setInputText("");
    setActiveTab("ai");
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1500);
  };

  const handleAskAboutWord = (word: string, meaning: string) => {
    setActiveTab("ai");
    onSendMessage(
      `単語「${word}」（意味: ${meaning}）について、この画像文脈における詳しい用法・ニュアンス・例文を解説してください。`,
    );
  };

  const hasImages = items.length > 0;

  return (
    <div className="flex flex-col h-full bg-slate-900 w-full overflow-hidden">
      {/* Top Header & Mode Tabs */}
      <div className="h-12 border-b border-slate-800 px-4 flex items-center justify-between shrink-0 bg-slate-900/80 backdrop-blur z-10">
        {/* Left: View Tabs */}
        <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 space-x-1">
          <button
            type="button"
            onClick={() => setActiveTab("reader")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
              activeTab === "reader"
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-slate-400 hover:text-white hover:bg-slate-800/60"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>📖 テキスト読解 & 辞書</span>
            {ocrText && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("vocab")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
              activeTab === "vocab"
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-slate-400 hover:text-white hover:bg-slate-800/60"
            }`}
          >
            <BookMarked className="w-3.5 h-3.5" />
            <span>単語帳</span>
            {vocabulary.words.length > 0 && (
              <span className="text-[10px] px-1 py-0.2 rounded-full bg-emerald-500/30 text-emerald-200 font-mono">
                {vocabulary.words.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("ai")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
              activeTab === "ai"
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-slate-400 hover:text-white hover:bg-slate-800/60"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>💡 AI解説 & チャット</span>
            {messages.length > 0 && (
              <span className="text-[10px] px-1 py-0.2 rounded-full bg-indigo-500/30 text-indigo-200 font-mono">
                {messages.length}
              </span>
            )}
          </button>
        </div>

        {/* Right: Reset & Image Count */}
        <div className="flex items-center gap-2">
          {hasImages && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono font-medium">
              {items.length}枚取り込み
            </span>
          )}

          {hasImages && (
            <button
              type="button"
              onClick={onReset}
              className="text-slate-400 hover:text-slate-200 p-1.5 rounded-md hover:bg-slate-800 text-xs flex items-center gap-1 transition-colors cursor-pointer"
              title="すべてリセット"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>リセット</span>
            </button>
          )}
        </div>
      </div>

      {/* Target Images Thumbnails Bar (Persistent across tabs when images present) */}
      {hasImages && (
        <div className="bg-slate-950/70 px-4 py-2 border-b border-slate-800/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
            <span className="text-[10px] font-mono text-slate-400 shrink-0 uppercase font-semibold">
              対象:
            </span>
            {items.map((item, idx) => {
              const isSelected = item.id === selectedId;
              const src = itemImageUrl(item);
              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => onSelectImage(item.id)}
                  className={`relative shrink-0 w-8 h-8 rounded-md overflow-hidden border cursor-pointer transition-all ${
                    isSelected
                      ? "border-indigo-400 ring-2 ring-indigo-400/50 scale-105"
                      : "border-slate-800 hover:border-slate-600 opacity-75 hover:opacity-100"
                  }`}
                  title={`画像 #${idx + 1}`}
                >
                  <img src={src} alt={`Target ${idx + 1}`} className="w-full h-full object-cover" />
                  <span className="absolute bottom-0 right-0 bg-black/80 text-[7px] font-mono text-white px-0.5">
                    {idx + 1}
                  </span>
                </button>
              );
            })}
          </div>

          {!ocrText && (
            <button
              type="button"
              disabled={isOcrLoading}
              onClick={onExtractOcr}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-medium shrink-0 ml-2 transition-all cursor-pointer shadow-xs disabled:opacity-50"
            >
              <FileText className="w-3 h-3" />
              <span>文字化 (OCR)</span>
            </button>
          )}
        </div>
      )}

      {/* Main Tab Content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === "reader" ? (
          <InteractiveReader
            ocrText={ocrText}
            isOcrLoading={isOcrLoading}
            onExtractOcr={onExtractOcr}
            onAskAboutWord={handleAskAboutWord}
            hasImages={hasImages}
            savedWords={vocabulary.savedWords}
            onSaveWord={vocabulary.onSave}
            onRemoveWord={vocabulary.onRemove}
          />
        ) : activeTab === "vocab" ? (
          <VocabularyList
            words={vocabulary.words}
            isLoading={vocabulary.isLoading}
            error={vocabulary.error}
            onRemove={vocabulary.onRemove}
            onSelectFolder={vocabulary.onSelectFolder}
          />
        ) : (
          /* AI Analysis & Chat Tab View */
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
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
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
                        {items.length > 1
                          ? `全${items.length}枚の日本語訳`
                          : "自然な日本語訳と原文"}
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
                        {msg.role === "user" ? "あなた" : "Gemini 3.8 Flash"}
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
                        ? `Geminiが全${items.length}枚の英文を解析中...`
                        : "Geminiが英文を解析中..."}
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
        )}
      </div>
    </div>
  );
};
