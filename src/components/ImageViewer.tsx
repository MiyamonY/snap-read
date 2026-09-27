import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ImageOff, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import type { CaptureItem } from "../types.ts";
import { itemImageUrl } from "../services/imageApi.ts";

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

interface ImageViewerProps {
  items: CaptureItem[];
}

/** フォルダ内の画像を縦に並べて表示する。拡大縮小（ボタン・Ctrl+ホイール）とドラッグでの移動ができる */
export const ImageViewer: React.FC<ImageViewerProps> = ({ items }) => {
  /** 1 = 表示領域の幅に合わせた大きさ */
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 拡大縮小の中心（表示領域内の座標）。描画後にこの点が動かないようスクロール位置を合わせる
  const anchorRef = useRef<{ x: number; y: number; ratio: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const zoomRef = useRef(1);

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

  // ドラッグで表示位置を移動する
  const handlePanStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = scrollRef.current;
    if (!container || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = {
      x: e.clientX,
      y: e.clientY,
      left: container.scrollLeft,
      top: container.scrollTop,
    };
  };

  const handlePanMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = scrollRef.current;
    const pan = panRef.current;
    if (!container || !pan) return;
    container.scrollLeft = pan.left - (e.clientX - pan.x);
    container.scrollTop = pan.top - (e.clientY - pan.y);
  };

  const handlePanEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panRef.current) return;
    panRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="relative flex flex-col h-full min-w-0 bg-slate-950">
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
        className="flex-1 min-h-0 overflow-auto p-4 cursor-grab active:cursor-grabbing select-none"
      >
        {items.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-xs text-slate-500">
            <ImageOff className="w-6 h-6" />
            <span>このフォルダには画像がありません</span>
          </div>
        )}
        <div className="mx-auto flex flex-col gap-4" style={{ width: `${zoom * 100}%` }}>
          {items.map((item, index) => (
            <img
              key={item.id}
              src={itemImageUrl(item)}
              alt={`画像 ${index + 1}`}
              draggable={false}
              className="w-full h-auto rounded-md border border-slate-800 shadow-lg"
            />
          ))}
        </div>
      </div>
    </div>
  );
};
