import React, { useState, useRef, useEffect } from "react";
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
import { aiService, MODEL_LABEL } from "../services/ai.ts";
import { normalizeOcrText } from "../services/ocrText.ts";

type ColumnCount = 1 | 2 | 4;

const COLUMN_OPTIONS: ColumnCount[] = [1, 2, 4];
const COLUMNS_STORAGE_KEY = "snapread_reader_columns";

const COLUMN_CLASSES: Record<ColumnCount, string> = {
  1: "columns-1",
  2: "columns-2 gap-8 [column-rule:1px_solid_var(--color-slate-800)]",
  4: "columns-4 gap-6 [column-rule:1px_solid_var(--color-slate-800)]",
};

/** 英単語（前後の記号付き）: 例 "“word,” */
const WORD_TOKEN = /^([^a-zA-Z]*)([a-zA-Z]+(?:['’-][a-zA-Z]+)*)([^a-zA-Z]*)$/u;

const tokenize = (paragraph: string) => paragraph.split(/(\s+)/u);

const cleanPhrase = (text: string) =>
  text.replaceAll(/^[^a-zA-Z]+|[^a-zA-Z]+$/gu, "").replaceAll(/\s+/gu, " ");

/** 段落内で、単語帳に登録済みの熟語（2語以上）に含まれるトークンの位置 */
const findSavedPhraseTokens = (tokens: string[], phrases: string[][]): Set<number> => {
  const words = tokens.flatMap((token, index) => {
    const match = token.match(WORD_TOKEN);
    return match ? [{ index, word: match[2].toLowerCase() }] : [];
  });
  const hits = new Set<number>();
  for (const phrase of phrases) {
    for (let start = 0; start + phrase.length <= words.length; start++) {
      if (phrase.every((w, k) => words[start + k].word === w)) {
        for (let k = 0; k < phrase.length; k++) hits.add(words[start + k].index);
      }
    }
  }
  return hits;
};

/** 選択中の範囲（段落番号とトークン位置） */
interface TokenSelection {
  paraIdx: number;
  start: number;
  end: number;
}

const loadColumnCount = (): ColumnCount => {
  const saved = Number(localStorage.getItem(COLUMNS_STORAGE_KEY));
  return COLUMN_OPTIONS.find((n) => n === saved) ?? 1;
};

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
  const [selection, setSelection] = useState<TokenSelection | null>(null);
  const [selectedContext, setSelectedContext] = useState("");
  const [definition, setDefinition] = useState<WordDefinition | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fontSize, setFontSize] = useState<"sm" | "base" | "lg">("base");
  const [columnCount, setColumnCount] = useState<ColumnCount>(loadColumnCount);

  const changeColumnCount = (count: ColumnCount) => {
    setColumnCount(count);
    localStorage.setItem(COLUMNS_STORAGE_KEY, String(count));
  };

  // Popover position
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 後から始めた検索の結果を、先に始めた検索の結果で上書きしないための通し番号
  const lookupSeqRef = useRef(0);

  const closePopover = () => {
    setSelectedWord(null);
    setSelection(null);
    setPopoverPos(null);
  };

  // Close popover on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".word-popover") && !target.closest(".interactive-word")) {
        setSelectedWord(null);
        setSelection(null);
        setPopoverPos(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  /** 語義を検索してポップアップを表示する（rect: 選択範囲の表示位置） */
  const openLookup = async (text: string, context: string, rect: DOMRect) => {
    const container = containerRef.current;
    if (!container) return;

    setSelectedWord(text);
    setSelectedContext(context);

    // Position above the selection, relative to the (scrollable) container
    const containerRect = container.getBoundingClientRect();
    const top = rect.top - containerRect.top + container.scrollTop;
    const left = rect.left - containerRect.left + container.scrollLeft + rect.width / 2;
    setPopoverPos({
      top: Math.max(10, top - 130),
      left: Math.max(
        container.scrollLeft + 10,
        Math.min(left - 144, container.scrollLeft + container.clientWidth - 290),
      ),
    });
    setIsLookingUp(true);
    setDefinition(null);

    lookupSeqRef.current += 1;
    const seq = lookupSeqRef.current;
    let def: WordDefinition | null = null;
    try {
      def = await aiService.lookupWordDefinition(text, context);
    } catch (err) {
      console.error("Lookup error:", err);
    }
    if (seq !== lookupSeqRef.current) return;
    setDefinition(def);
    setIsLookingUp(false);
  };

  /** 単語クリック。Shift+クリックで同じ段落内の選択範囲を広げ、熟語として検索する */
  const handleWordClick = (
    paraIdx: number,
    tokenIdx: number,
    paragraph: string,
    wordElement: HTMLElement,
    shiftKey: boolean,
  ) => {
    const extend = shiftKey && selection?.paraIdx === paraIdx;
    const range = extend
      ? { start: Math.min(selection.start, tokenIdx), end: Math.max(selection.end, tokenIdx) }
      : { start: tokenIdx, end: tokenIdx };
    if (shiftKey) {
      // Shift+クリックで広がるブラウザのテキスト選択は使わない
      globalThis.getSelection()?.removeAllRanges();
    }
    const text = cleanPhrase(
      tokenize(paragraph)
        .slice(range.start, range.end + 1)
        .join(""),
    );
    if (!text) return;
    setSelection({ paraIdx, ...range });
    openLookup(text, paragraph, wordElement.getBoundingClientRect());
  };

  /**
   * 本文のクリック。単語は（ドラッグでの範囲選択ができるよう）ボタンではなくテキストで描画し、
   * クリックされた単語は data 属性から特定する
   */
  const handleTextClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const wordElement = (e.target as HTMLElement).closest<HTMLElement>("[data-token]");
    if (!wordElement) return;
    const paraIdx = Number(wordElement.dataset.para);
    const tokenIdx = Number(wordElement.dataset.token);
    const paragraph = normalizeOcrText(ocrText).split("\n\n")[paraIdx] ?? "";
    handleWordClick(paraIdx, tokenIdx, paragraph, wordElement, e.shiftKey);
  };

  /** ドラッグで複数語を選択した場合は、その熟語を検索する */
  const handleTextMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    // Shift+クリックはクリック側で熟語として扱う（ブラウザの選択範囲の拡張とは二重に検索しない）
    if (e.shiftKey) return;
    const nativeSelection = globalThis.getSelection();
    if (!nativeSelection || nativeSelection.isCollapsed) return;
    const text = cleanPhrase(nativeSelection.toString());
    // 1語はクリックで扱う。長すぎる範囲は熟語とみなさない
    if (!text.includes(" ") || text.split(" ").length > 8) return;
    const range = nativeSelection.getRangeAt(0);
    const paragraph = range.startContainer.parentElement?.closest("p")?.textContent ?? "";
    setSelection(null);
    openLookup(text, paragraph, range.getBoundingClientRect());
  };

  /** 段組み表示では縦ホイールで横にスクロールする */
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (columnCount === 1 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.currentTarget.scrollLeft += e.deltaY;
  };

  const handleCopy = () => {
    if (!ocrText) return;
    navigator.clipboard.writeText(normalizeOcrText(ocrText));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Render text with clickable words
  const renderInteractiveText = (text: string) => {
    const paragraphs = normalizeOcrText(text).split("\n\n");
    const savedPhrases = [...savedWords].filter((w) => w.includes(" ")).map((w) => w.split(" "));

    return paragraphs.map((para, pIdx) => {
      if (!para.trim()) return <div key={pIdx} className="h-3" />;

      // Header detection like [画像1]
      if (para.startsWith("[") && para.endsWith("]")) {
        return (
          <div
            key={pIdx}
            className="text-xs font-mono font-bold text-indigo-400 mt-4 first:mt-0 mb-1.5 flex items-center gap-1.5 break-after-avoid"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
            {para}
          </div>
        );
      }

      // Split into words and punctuation
      const tokens = tokenize(para);
      const savedPhraseTokens = findSavedPhraseTokens(tokens, savedPhrases);

      return (
        <p key={pIdx} className="indent-[2ch] leading-relaxed text-slate-200">
          {tokens.map((token, tIdx) => {
            // Whitespace
            if (/^\s+$/u.test(token)) {
              return <span key={tIdx}>{token}</span>;
            }

            // Word with potential punctuation: e.g. "word,"
            const match = token.match(WORD_TOKEN);
            if (!match) {
              return <span key={tIdx}>{token}</span>;
            }

            const prefix = match[1];
            const word = match[2];
            const suffix = match[3];
            const isSelected =
              selection?.paraIdx === pIdx && tIdx >= selection.start && tIdx <= selection.end;
            const isSaved = savedWords.has(word.toLowerCase()) || savedPhraseTokens.has(tIdx);

            return (
              <span key={tIdx} className="whitespace-nowrap">
                {prefix}
                <span
                  data-para={pIdx}
                  data-token={tIdx}
                  className={`interactive-word cursor-pointer rounded transition-colors select-text ${
                    isSelected
                      ? "bg-indigo-600 text-white font-medium shadow-xs ring-2 ring-indigo-400/50"
                      : isSaved
                        ? "text-emerald-200 underline decoration-emerald-400/70 decoration-2 underline-offset-3 hover:bg-emerald-500/20"
                        : "hover:bg-indigo-500/25 hover:text-indigo-200 hover:underline underline-offset-3 decoration-indigo-400/60"
                  }`}
                  title={
                    isSaved
                      ? "単語帳に登録済み（クリックで語義を表示）"
                      : "クリックで語義を表示（Shift+クリックで熟語を選択）"
                  }
                >
                  {word}
                </span>
                {suffix}
              </span>
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
            <span className="text-[10px] text-slate-500">
              （単語をクリックで辞書表示・Shift+クリックかドラッグで熟語）
            </span>
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

          {/* Column layout controls */}
          <div
            className="flex items-center bg-slate-900 border border-slate-800 rounded-md p-0.5 mr-2"
            title="段組み"
          >
            {COLUMN_OPTIONS.map((count) => (
              <button
                type="button"
                key={count}
                onClick={() => changeColumnCount(count)}
                className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${columnCount === count ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}
                title={`${count}段組み`}
              >
                {count}段
              </button>
            ))}
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
      <div
        ref={containerRef}
        onWheel={handleWheel}
        className={`relative flex-1 min-h-0 p-5 ${
          columnCount === 1 ? "overflow-y-auto" : "overflow-x-auto overflow-y-hidden"
        } ${fontSizeClass}`}
      >
        {isOcrLoading ? (
          <div className="flex flex-col items-center justify-center h-48 space-y-3 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
            <p className="text-xs text-slate-300 font-medium">
              画像から英文テキストを抽出しています...
            </p>
            <span className="text-[11px] text-slate-500">
              {MODEL_LABEL} が段落や文字を高精度OCR認識中
            </span>
          </div>
        ) : ocrText ? (
          // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- 単語のクリックとテキスト範囲選択（マウス操作）を拾う
          <div
            onClick={handleTextClick}
            onMouseUp={handleTextMouseUp}
            className={`font-sans antialiased max-w-none select-text ${COLUMN_CLASSES[columnCount]} ${
              columnCount === 1 ? "" : "h-full [column-fill:auto]"
            }`}
          >
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
                onClick={closePopover}
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

                {/* Ask AI about this word */}
                <button
                  type="button"
                  onClick={() => {
                    onAskAboutWord(definition.word, definition.meaning);
                    closePopover();
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
