import React, { useState, useRef, useCallback } from "react";
import { Crop, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { CropRect } from "../types.ts";
import type { ImageFormat } from "../services/imageApi.ts";

interface ImageCropperProps {
  imageUrl: string;
  /** 切り抜いた画像の保存形式（元の画像に合わせる） */
  outputFormat: ImageFormat;
  currentIndex: number;
  totalCount: number;
  /** 切り抜いた画像の data URL（範囲未選択で適用した場合は null） */
  onApplyCropToCurrent: (croppedDataUrl: string | null) => void;
  onAddMore: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDeleteCurrent: () => void;
}

export const ImageCropper: React.FC<ImageCropperProps> = ({
  imageUrl,
  outputFormat,
  currentIndex,
  totalCount,
  onApplyCropToCurrent,
  onAddMore,
  onPrev,
  onNext,
  onDeleteCurrent,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);

  // Reset crop when image changes
  const [prevImageUrl, setPrevImageUrl] = useState(imageUrl);
  if (prevImageUrl !== imageUrl) {
    setPrevImageUrl(imageUrl);
    setCropRect(null);
  }

  // Handle Mouse Down
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    setIsDragging(true);
    setStartPos({ x, y });
    setCropRect({ x, y, width: 0, height: 0 });
  };

  // Handle Mouse Move
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !startPos || !imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const currentY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const x = Math.min(startPos.x, currentX);
    const y = Math.min(startPos.y, currentY);
    const width = Math.abs(currentX - startPos.x);
    const height = Math.abs(currentY - startPos.y);

    setCropRect({ x, y, width, height });
  };

  // Handle Mouse Up
  const handleMouseUp = () => {
    setIsDragging(false);
    if (cropRect && (cropRect.width < 10 || cropRect.height < 10)) {
      setCropRect(null);
    }
  };

  /**
   * 選択範囲（または全画面）をCanvasで切り出して更新
   */
  const handleApplyCrop = useCallback(() => {
    if (!imageRef.current) return;
    const img = imageRef.current;

    if (!cropRect || cropRect.width < 10 || cropRect.height < 10) {
      onApplyCropToCurrent(null);
      return;
    }

    const displayRect = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / displayRect.width;
    const scaleY = img.naturalHeight / displayRect.height;

    const naturalCropX = cropRect.x * scaleX;
    const naturalCropY = cropRect.y * scaleY;
    const naturalCropW = cropRect.width * scaleX;
    const naturalCropH = cropRect.height * scaleY;

    const canvas = document.createElement("canvas");
    canvas.width = naturalCropW;
    canvas.height = naturalCropH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(
      img,
      naturalCropX,
      naturalCropY,
      naturalCropW,
      naturalCropH,
      0,
      0,
      naturalCropW,
      naturalCropH,
    );

    const croppedDataUrl = canvas.toDataURL(outputFormat.type, outputFormat.quality);
    onApplyCropToCurrent(croppedDataUrl);
    setCropRect(null);
  }, [cropRect, onApplyCropToCurrent, outputFormat]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex flex-col items-center justify-center bg-slate-950 overflow-hidden select-none"
    >
      {/* Top Banner Guide with Page Indicator */}
      <div className="absolute top-3 z-10 bg-slate-900/90 backdrop-blur px-4 py-1.5 rounded-full border border-slate-700/80 text-[11px] text-slate-300 flex items-center gap-3 shadow-lg">
        <span className="font-mono bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded text-[10px] font-semibold">
          画像 {currentIndex + 1} / {totalCount}
        </span>
        <div className="flex items-center gap-1.5 text-slate-300">
          <Crop className="w-3.5 h-3.5 text-indigo-400" />
          <span>ドラッグで範囲を選択（右パネルで全画像を解析可能）</span>
        </div>
      </div>

      {/* Prev / Next Page Overlay Arrows */}
      {totalCount > 1 && (
        <>
          <button
            type="button"
            onClick={onPrev}
            disabled={currentIndex === 0}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer shadow-xl"
            title="前の画像"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={onNext}
            disabled={currentIndex === totalCount - 1}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer shadow-xl"
            title="次の画像"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </>
      )}

      {/* Image Area with Drag-to-Crop Overlay */}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- マウスドラッグ専用の切り抜き領域 */}
      <div
        className="relative max-w-full max-h-full flex items-center justify-center cursor-crosshair p-4"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <img
          ref={imageRef}
          src={imageUrl}
          alt={`Captured frame ${currentIndex + 1}`}
          className="max-h-[calc(100vh-170px)] max-w-full object-contain pointer-events-none rounded-lg shadow-2xl border border-slate-800"
          draggable={false}
        />

        {/* Selection Rectangle Box */}
        {cropRect && cropRect.width > 5 && cropRect.height > 5 && (
          <div
            className="absolute border-2 border-indigo-400 bg-indigo-500/15 pointer-events-none rounded-xs shadow-sm"
            style={{
              left: `${cropRect.x}px`,
              top: `${cropRect.y}px`,
              width: `${cropRect.width}px`,
              height: `${cropRect.height}px`,
            }}
          >
            <span className="absolute -top-6 left-0 bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded font-mono font-medium shadow-sm">
              選択中 {Math.round(cropRect.width)}×{Math.round(cropRect.height)}
            </span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="absolute bottom-4 flex items-center gap-2.5 bg-slate-900/95 backdrop-blur px-4 py-2 rounded-full border border-slate-700 shadow-2xl z-10">
        <button
          type="button"
          onClick={onAddMore}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-slate-800 hover:bg-indigo-600 text-slate-200 text-xs font-medium transition-all cursor-pointer"
          title="さらにカメラ・画面から画像を追加"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>追加撮影</span>
        </button>

        {cropRect && cropRect.width > 10 ? (
          <button
            type="button"
            onClick={handleApplyCrop}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
          >
            <Crop className="w-3.5 h-3.5" />
            <span>選択範囲を切り抜き</span>
          </button>
        ) : null}

        {cropRect && (
          <button
            type="button"
            onClick={() => setCropRect(null)}
            className="px-2.5 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs transition-colors cursor-pointer"
          >
            解除
          </button>
        )}

        <button
          type="button"
          onClick={onDeleteCurrent}
          className="px-3 py-1.5 rounded-full bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 text-xs font-medium transition-colors cursor-pointer"
          title="この画像を削除"
        >
          削除
        </button>
      </div>
    </div>
  );
};
