import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  FileText,
  Sparkles,
  Loader2,
  Copy,
  Check,
  RotateCcw,
  X,
  BookmarkPlus,
  BookmarkCheck,
} from "lucide-react";
import type { VocabularyInput, WordDefinition } from "../types.ts";
import { geminiService } from "../services/gemini.ts";

interface InteractiveReaderProps {
  ocrText: string;
  isOcrLoading: boolean;
  onExtractOcr: () => void;
  onAskAboutWord: (word: string, meaning: string) => void;
  hasImages: boolean;
  /** 単語帳に登録済みの単語（小文字） */
  savedWords: Set<string>;
  onSaveWord: (word: string, input: VocabularyInput) => void;
  onRemoveWord: (word: string) => void;
}

export const InteractiveReader: React.FC<InteractiveReaderProps> = ({
  ocrText,
  isOcrLoading,
  onExtractOcr,
  onAskAboutWord,
  hasImages,
  savedWords,
  onSaveWord,
  onRemoveWord,
}) => {
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [selectedContext, setSelectedContext] = useState("");
  const [definition, setDefinition] = useState<WordDefinition | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fontSize, setFontSize] = useState<"sm" | "base" | "lg">("base");

  // Popover position
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close popover on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".word-popover") && !target.closest(".interactive-word")) {
        setSelectedWord(null);
        setPopoverPos(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle word click
  const handleWordClick = useCallback(
    async (word: string, sentenceContext: string, e: React.MouseEvent<HTMLButtonElement>) => {
      const clean = word.replaceAll(/^[^a-zA-Z]+|[^a-zA-Z]+$/gu, "");
      if (!clean) return;

      setSelectedWord(clean);
      setSelectedContext(sentenceContext);

      // Compute popover position relative to container
      const rect = e.currentTarget.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect() || { top: 0, left: 0 };

      // Position above word by default, or below if too close to top
      const top = rect.top - containerRect.top + (containerRef.current?.scrollTop || 0);
      const left =
        rect.left - containerRect.left + (containerRef.current?.scrollLeft || 0) + rect.width / 2;

      const containerWidth = containerRef.current?.clientWidth || 300;
      setPopoverPos({
        top: Math.max(10, top - 130),
        left: Math.max(10, Math.min(left - 144, containerWidth - 290)),
      });
      setIsLookingUp(true);
      setDefinition(null);

      try {
        const def = await geminiService.lookupWordDefinition(clean, sentenceContext);
        setDefinition(def);
      } catch (err) {
        console.error("Lookup error:", err);
      }
      setIsLookingUp(false);
    },
    [],
  );

  const handleCopy = () => {
    if (!ocrText) return;
    navigator.clipboard.writeText(ocrText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Render text with clickable words
  const renderInteractiveText = (text: string) => {
    const paragraphs = text.split(/\n\s*\n|\n/u);

    return paragraphs.map((para, pIdx) => {
      if (!para.trim()) return <div key={pIdx} className="h-3" />;

      // Header detection like [画像1]
      if (para.startsWith("[") && para.endsWith("]")) {
        return (
          <div
            key={pIdx}
            className="text-xs font-mono font-bold text-indigo-400 mt-4 mb-1.5 flex items-center gap-1.5"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
            {para}
          </div>
        );
      }

      // Split into words and punctuation
      const tokens = para.split(/(\s+)/u);

      return (
        <p key={pIdx} className="my-2 leading-relaxed text-slate-200">
          {tokens.map((token, tIdx) => {
            // Whitespace
            if (/^\s+$/u.test(token)) {
              return <span key={tIdx}>{token}</span>;
            }

            // Word with potential punctuation: e.g. "word,"
            const match = token.match(/^([^a-zA-Z]*)([a-zA-Z]+(?:['’-][a-zA-Z]+)*)([^a-zA-Z]*)$/u);
            if (!match) {
              return <span key={tIdx}>{token}</span>;
            }

            const prefix = match[1];
            const word = match[2];
            const suffix = match[3];
            const isSelected = selectedWord?.toLowerCase() === word.toLowerCase();
            const isSaved = savedWords.has(word.toLowerCase());

            return (
              <React.Fragment key={tIdx}>
                {prefix}
                <button
                  type="button"
                  onClick={(e) => handleWordClick(word, para, e)}
                  className={`interactive-word inline-block cursor-pointer rounded px-0.5 transition-all select-text ${
                    isSelected
                      ? "bg-indigo-600 text-white font-medium shadow-xs ring-2 ring-indigo-400/50"
                      : isSaved
                        ? "text-emerald-200 underline decoration-emerald-400/70 decoration-2 underline-offset-3 hover:bg-emerald-500/20"
                        : "hover:bg-indigo-500/25 hover:text-indigo-200 hover:underline underline-offset-3 decoration-indigo-400/60"
                  }`}
                  title={
                    isSaved
                      ? "単語帳に登録済み（クリックで語義を表示）"
                      : "クリックして日本語の語義を表示"
                  }
                >
                  {word}
                </button>
                {suffix}
              </React.Fragment>
            );
          })}
        </p>
      );
    });
  };

  const fontSizeClass = {
    sm: "text-xs",
    base: "text-sm",
    lg: "text-base",
  }[fontSize];

  return (
    <div className="relative flex flex-col h-full bg-slate-900 overflow-hidden">
      {/* Sub Header Toolbar */}
      <div className="h-10 border-b border-slate-800/80 px-4 flex items-center justify-between shrink-0 bg-slate-950/40 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-medium text-slate-300">インタラクティブテキスト読解</span>
          {ocrText && (
            <span className="text-[10px] text-slate-500">（単語をクリックで辞書表示）</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Font Size controls */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-md p-0.5 mr-2">
            <button
              type="button"
              onClick={() => setFontSize("sm")}
              className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${fontSize === "sm" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}
              title="小"
            >
              小
            </button>
            <button
              type="button"
              onClick={() => setFontSize("base")}
              className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${fontSize === "base" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}
              title="中"
            >
              中
            </button>
            <button
              type="button"
              onClick={() => setFontSize("lg")}
              className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${fontSize === "lg" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}
              title="大"
            >
              大
            </button>
          </div>

          {ocrText && (
            <>
              <button
                type="button"
                onClick={handleCopy}
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
                title="テキストをコピー"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                type="button"
                disabled={isOcrLoading}
                onClick={onExtractOcr}
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                title="OCRテキストを再抽出"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Reader View */}
      <div ref={containerRef} className={`relative flex-1 p-5 overflow-y-auto ${fontSizeClass}`}>
        {isOcrLoading ? (
          <div className="flex flex-col items-center justify-center h-48 space-y-3 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
            <p className="text-xs text-slate-300 font-medium">
              画像から英文テキストを抽出しています...
            </p>
            <span className="text-[11px] text-slate-500">
              Gemini 3.8 Flash が段落や文字を高精度OCR認識中
            </span>
          </div>
        ) : ocrText ? (
          <div className="font-sans antialiased max-w-none select-text">
            {renderInteractiveText(ocrText)}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-52 text-center p-6 space-y-3">
            <div className="w-12 h-12 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-200">
                {hasImages
                  ? "画像からテキスト（OCR）を抽出できます"
                  : "まず右側で画像をキャプチャしてください"}
              </p>
              <p className="text-[11px] text-slate-400 mt-1 max-w-sm">
                文字化された英文は、分からない単語をクリックするだけで文脈に合った日本語の語義がポップアップ表示されます。
              </p>
            </div>

            {hasImages && (
              <button
                type="button"
                onClick={onExtractOcr}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>テキストをOCR抽出する</span>
              </button>
            )}
          </div>
        )}

        {/* Word Definition Popover Card */}
        {selectedWord && popoverPos && (
          <div
            className="word-popover absolute z-30 w-72 bg-slate-900 border border-indigo-500/50 rounded-xl p-3.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
            style={{
              top: `${popoverPos.top}px`,
              left: `${popoverPos.left}px`,
            }}
          >
            {/* Header: Word & Close */}
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-white text-sm">{selectedWord}</span>
                {definition?.phonetic && (
                  <span className="text-[10px] font-mono text-slate-400">
                    /{definition.phonetic}/
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedWord(null);
                  setPopoverPos(null);
                }}
                className="text-slate-400 hover:text-white p-0.5 rounded hover:bg-slate-800"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Content Body */}
            {isLookingUp ? (
              <div className="flex items-center gap-2 py-4 justify-center text-xs text-indigo-300">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>語義を検索中...</span>
              </div>
            ) : definition ? (
              <div className="pt-2 space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold px-1.5 py-0.5 rounded">
                    {definition.partOfSpeech}
                  </span>
                  <span className="text-white font-semibold text-sm">{definition.meaning}</span>
                </div>

                {definition.detail && (
                  <p className="text-[11px] text-slate-300 leading-relaxed bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
                    {definition.detail}
                  </p>
                )}

                {/* Save to / remove from the folder's vocabulary list */}
                {savedWords.has(definition.word.toLowerCase()) ? (
                  <button
                    type="button"
                    onClick={() => onRemoveWord(definition.word)}
                    className="w-full mt-1.5 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-rose-500/20 text-emerald-300 hover:text-rose-300 text-[11px] font-medium transition-colors cursor-pointer"
                    title="クリックで単語帳から削除"
                  >
                    <BookmarkCheck className="w-3 h-3" />
                    <span>単語帳に登録済み</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      onSaveWord(definition.word, {
                        phonetic: definition.phonetic,
                        partOfSpeech: definition.partOfSpeech,
                        meaning: definition.meaning,
                        detail: definition.detail,
                        context: selectedContext,
                      })
                    }
                    className="w-full mt-1.5 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-emerald-600 text-slate-300 hover:text-white text-[11px] font-medium transition-colors cursor-pointer"
                  >
                    <BookmarkPlus className="w-3 h-3" />
                    <span>単語帳に追加</span>
                  </button>
                )}

                {/* Ask Gemini about this word */}
                <button
                  type="button"
                  onClick={() => {
                    onAskAboutWord(definition.word, definition.meaning);
                    setSelectedWord(null);
                    setPopoverPos(null);
                  }}
                  className="w-full mt-1.5 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white text-[11px] font-medium transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3 h-3 text-indigo-400 group-hover:text-white" />
                  <span>この単語について詳しく質問</span>
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};
