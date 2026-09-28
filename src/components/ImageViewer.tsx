import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ImageOff, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import type { CaptureItem, OcrLayout, OcrWord } from "../types.ts";
import { imageApi, itemImageUrl } from "../services/imageApi.ts";
import { cleanPhrase, findSavedPhraseTokens, savedPhraseList } from "../services/wordMatch.ts";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.25;

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

interface ZoomState {
  /** スクロール領域 */
  container: React.RefObject<HTMLDivElement | null>;
  /** 最新の倍率（連続したホイール操作でも正しく計算するため state とは別に持つ） */
  current: React.RefObject<number>;
  /** 拡大縮小の中心。描画後にこの点が動かないようスクロール位置を合わせる */
  anchor: React.RefObject<{ x: number; y: number; ratio: number } | null>;
  setZoom: (zoom: number) => void;
}

/** 倍率を変更する（next: 絶対倍率 または 現在の倍率からの変換、anchor: 表示領域内の拡大の中心） */
const applyZoom = (
  state: ZoomState,
  next: number | ((current: number) => number),
  anchor?: { x: number; y: number },
) => {
  const current = state.current.current;
  const zoom = clampZoom(typeof next === "function" ? next(current) : next);
  if (zoom === current) return;
  const container = state.container.current;
  if (container) {
    state.anchor.current = {
      x: anchor?.x ?? container.clientWidth / 2,
      y: anchor?.y ?? container.clientHeight / 2,
      ratio: zoom / current,
    };
  }
  state.current.current = zoom;
  state.setZoom(zoom);
};

/**
 * 拡大表示時のシャープ化の強さ（3x3 のシャープ化カーネルの周囲の重み）。
 * 100% 以下では 0（かけない）。拡大するほどぼけるので、倍率に応じて強くする
 */
const sharpenAmount = (zoom: number) => (zoom <= 1 ? 0 : Math.min(1, 0.35 + (zoom - 1) * 0.25));

/** 周囲4画素を差し引き、中心を強める（合計 1 なので明るさは変わらない） */
const sharpenKernel = (amount: number) =>
  [0, -amount, 0, -amount, 1 + 4 * amount, -amount, 0, -amount, 0].join(" ");

/** ドラッグで選択できる熟語の最大語数 */
const MAX_PHRASE_WORDS = 8;

const isPunctuation = (text: string) => /^[^a-zA-Z0-9]+$/u.test(text);

/** Vision の単語（句読点が独立している）をつなげて語句にする */
const joinWords = (words: OcrWord[]) => {
  let text = "";
  for (const word of words) {
    text += text && !isPunctuation(word.text) ? ` ${word.text}` : word.text;
  }
  return cleanPhrase(text);
};

/** 画像上で選択中の単語の範囲 */
interface WordSelection {
  imageId: string;
  start: number;
  end: number;
}

interface ImageViewerProps {
  items: CaptureItem[];
  /** 単語帳に登録済みの単語・熟語（小文字）。画像上でもハイライトする */
  savedWords: Set<string>;
  /** 画像上で選んだ単語・熟語の語義を検索する（rect: 選択範囲の画面上の位置） */
  onLookup: (text: string, context: string, rect: DOMRect) => void;
  /** 変わったら OCR のレイアウトを取り直す（OCR 結果のテキスト） */
  layoutVersion: string;
  onScroll?: () => void;
}

const imageIdOf = (item: CaptureItem) => item.croppedImageId ?? item.imageId;

/** 画面上の位置にある画像上の単語 */
const wordAt = (x: number, y: number) =>
  document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-word]") ?? null;

/** フォルダ内の画像を縦に並べて表示する。拡大縮小（ボタン・Ctrl+ホイール）とドラッグでの移動ができる */
export const ImageViewer: React.FC<ImageViewerProps> = ({
  items,
  savedWords,
  onLookup,
  layoutVersion,
  onScroll,
}) => {
  /** 1 = 表示領域の幅に合わせた大きさ */
  const [zoom, setZoom] = useState(1);
  const sharpenFilterId = useId();
  const sharpen = sharpenAmount(zoom);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 拡大縮小の中心（表示領域内の座標）。描画後にこの点が動かないようスクロール位置を合わせる
  const anchorRef = useRef<{ x: number; y: number; ratio: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const zoomRef = useRef(1);

  // OCR で認識した単語の位置（画像 ID ごと。未 OCR なら null）
  const [layouts, setLayouts] = useState<Record<string, OcrLayout | null>>({});
  const imageIdsKey = items.map((item) => imageIdOf(item)).join(",");
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const ids = imageIdsKey.split(",").filter(Boolean);
      const entries = await Promise.all(
        ids.map(async (id) => [id, await imageApi.fetchLayout(id).catch(() => null)] as const),
      );
      if (!cancelled) setLayouts(Object.fromEntries(entries));
    };
    load();
    return () => {
      cancelled = true;
    };
    // OCR をやり直したら（layoutVersion が変わったら）取り直す
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [imageIdsKey, layoutVersion]);

  // 画像上の単語の選択（クリック・ドラッグ・Shift+クリック）
  const [selection, setSelection] = useState<WordSelection | null>(null);
  const wordDragRef = useRef<{ imageId: string; anchor: number; end: number } | null>(null);

  // 語義のポップアップ・単語以外をクリックしたら選択を解除する
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".word-popover") && !target.closest("[data-word]")) {
        setSelection(null);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const updateWordDrag = (imageId: string, anchor: number, end: number) => {
    wordDragRef.current = { imageId, anchor, end };
    setSelection({ imageId, start: Math.min(anchor, end), end: Math.max(anchor, end) });
  };

  /** 選択した範囲の語句を検索する */
  const finishWordDrag = () => {
    const drag = wordDragRef.current;
    wordDragRef.current = null;
    const layout = drag && layouts[drag.imageId];
    if (!drag || !layout) return;
    const start = Math.min(drag.anchor, drag.end);
    const end = Math.max(drag.anchor, drag.end);
    const words = layout.words.slice(start, end + 1);
    const text = joinWords(words);
    if (!text || text.split(" ").length > MAX_PHRASE_WORDS) return;
    const context = [...new Set(words.map((w) => w.paragraph))]
      .map((index) => layout.paragraphs[index])
      .join(" ");
    const first = document.querySelector(`[data-image="${drag.imageId}"][data-word="${start}"]`);
    const last = document.querySelector(`[data-image="${drag.imageId}"][data-word="${end}"]`);
    if (!first || !last) return;
    const a = first.getBoundingClientRect();
    const b = last.getBoundingClientRect();
    const left = Math.min(a.left, b.left);
    const top = Math.min(a.top, b.top);
    onLookup(
      text,
      context,
      new DOMRect(left, top, Math.max(a.right, b.right) - left, Math.max(a.bottom, b.bottom) - top),
    );
  };

  const zoomTo = (
    next: number | ((current: number) => number),
    anchor?: { x: number; y: number },
  ) =>
    applyZoom({ container: scrollRef, current: zoomRef, anchor: anchorRef, setZoom }, next, anchor);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    const anchor = anchorRef.current;
    if (!container || !anchor) return;
    anchorRef.current = null;
    container.scrollLeft = (container.scrollLeft + anchor.x) * anchor.ratio - anchor.x;
    container.scrollTop = (container.scrollTop + anchor.y) * anchor.ratio - anchor.y;
    // 倍率が変わって再描画された直後に実行するため、zoom をきっかけとして依存に含めている
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [zoom]);

  // Ctrl+ホイールで拡大縮小（ブラウザ自体の拡大を止めるため passive: false で登録する）
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      applyZoom(
        { container: scrollRef, current: zoomRef, anchor: anchorRef, setZoom },
        (current) => current * factor,
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
      );
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  // 単語の上からのドラッグは語句の選択、それ以外のドラッグは表示位置の移動
  const handlePanStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = scrollRef.current;
    if (!container || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    const word = (e.target as HTMLElement).closest<HTMLElement>("[data-word]");
    if (word) {
      const imageId = word.dataset.image ?? "";
      const index = Number(word.dataset.word);
      // Shift+クリックは、選択中の範囲の反対側の端を起点に広げる
      const anchor =
        e.shiftKey && selection?.imageId === imageId
          ? index < selection.start
            ? selection.end
            : selection.start
          : index;
      updateWordDrag(imageId, anchor, index);
      return;
    }

    panRef.current = {
      x: e.clientX,
      y: e.clientY,
      left: container.scrollLeft,
      top: container.scrollTop,
    };
  };

  const handlePanMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = wordDragRef.current;
    if (drag) {
      const word = wordAt(e.clientX, e.clientY);
      if (word?.dataset.image === drag.imageId && Number(word.dataset.word) !== drag.end) {
        updateWordDrag(drag.imageId, drag.anchor, Number(word.dataset.word));
      }
      return;
    }
    const container = scrollRef.current;
    const pan = panRef.current;
    if (!container || !pan) return;
    container.scrollLeft = pan.left - (e.clientX - pan.x);
    container.scrollTop = pan.top - (e.clientY - pan.y);
  };

  const handlePanEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (wordDragRef.current) {
      finishWordDrag();
      return;
    }
    panRef.current = null;
  };

  const savedPhrases = savedPhraseList(savedWords);
  const hasOcrText = layoutVersion.trim() !== "";
  const missingLayout = hasOcrText && items.some((item) => layouts[imageIdOf(item)] === null);

  return (
    <div className="relative flex flex-col h-full min-w-0 bg-slate-950">
      {/* Sharpening filter for zoomed-in images (applied after upscaling) */}
      {sharpen > 0 && (
        <svg width="0" height="0" className="absolute" aria-hidden="true">
          <filter id={sharpenFilterId} colorInterpolationFilters="sRGB">
            <feConvolveMatrix
              order="3"
              kernelMatrix={sharpenKernel(sharpen)}
              preserveAlpha="true"
            />
          </filter>
        </svg>
      )}

      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-900/90 border border-slate-700 shadow-lg text-slate-300">
        <button
          type="button"
          onClick={() => zoomTo((current) => current / ZOOM_STEP)}
          disabled={zoom <= MIN_ZOOM}
          className="p-1.5 rounded-md hover:bg-slate-800 hover:text-white disabled:opacity-40 cursor-pointer"
          title="縮小（Ctrl+ホイールでも拡大縮小できます）"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => zoomTo(1)}
          className="min-w-12 px-1.5 py-1 rounded-md hover:bg-slate-800 hover:text-white text-[11px] font-mono cursor-pointer"
          title="幅に合わせる"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomTo((current) => current * ZOOM_STEP)}
          disabled={zoom >= MAX_ZOOM}
          className="p-1.5 rounded-md hover:bg-slate-800 hover:text-white disabled:opacity-40 cursor-pointer"
          title="拡大（Ctrl+ホイールでも拡大縮小できます）"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => zoomTo(1)}
          className="p-1.5 rounded-md hover:bg-slate-800 hover:text-white cursor-pointer"
          title="幅に合わせる"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- 拡大した画像をドラッグで移動するためのマウス操作 */}
      <div
        ref={scrollRef}
        onPointerDown={handlePanStart}
        onPointerMove={handlePanMove}
        onPointerUp={handlePanEnd}
        onPointerCancel={handlePanEnd}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-auto p-4 cursor-grab active:cursor-grabbing select-none"
      >
        {missingLayout && (
          <div className="mb-3 px-3 py-1.5 rounded-md bg-slate-900 border border-slate-700 text-[11px] text-slate-400">
            OCR を再実行すると、画像上の単語をクリックして語義を調べられます
          </div>
        )}
        {items.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-xs text-slate-500">
            <ImageOff className="w-6 h-6" />
            <span>このフォルダには画像がありません</span>
          </div>
        )}
        <div className="mx-auto flex flex-col gap-4" style={{ width: `${zoom * 100}%` }}>
          {items.map((item, index) => {
            const imageId = imageIdOf(item);
            const layout = layouts[imageId];
            const savedPhraseWords = layout
              ? findSavedPhraseTokens(
                  layout.words.map((w) => w.text),
                  savedPhrases,
                )
              : new Set<number>();
            return (
              <div key={item.id} className="relative">
                <img
                  src={itemImageUrl(item)}
                  alt={`画像 ${index + 1}`}
                  draggable={false}
                  className="w-full h-auto rounded-md border border-slate-800 shadow-lg"
                  style={
                    sharpen > 0 ? { filter: `url(#${CSS.escape(sharpenFilterId)})` } : undefined
                  }
                />
                {/* Transparent text layer: words positioned over the image (sizes follow the zoom via cqh) */}
                {layout && (
                  <div className="absolute inset-0 [container-type:size]">
                    {layout.words.map((word, wordIndex) => {
                      const isSelected =
                        selection?.imageId === imageId &&
                        wordIndex >= selection.start &&
                        wordIndex <= selection.end;
                      const isSaved =
                        savedWords.has(cleanPhrase(word.text).toLowerCase()) ||
                        savedPhraseWords.has(wordIndex);
                      return (
                        <span
                          // oxlint-disable-next-line react/no-array-index-key -- 単語の位置は OCR 結果ごとに固定
                          key={wordIndex}
                          data-image={imageId}
                          data-word={wordIndex}
                          className={`interactive-word absolute overflow-hidden whitespace-nowrap leading-none text-transparent rounded-[2px] cursor-pointer ${
                            isSelected
                              ? "bg-indigo-500/35 ring-1 ring-indigo-400"
                              : isSaved
                                ? "bg-emerald-400/20 border-b-2 border-emerald-400"
                                : "hover:bg-indigo-400/25"
                          }`}
                          style={{
                            left: `${word.x * 100}%`,
                            top: `${word.y * 100}%`,
                            width: `${word.w * 100}%`,
                            height: `${word.h * 100}%`,
                            fontSize: `${word.h * 80}cqh`,
                          }}
                        >
                          {word.text}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
