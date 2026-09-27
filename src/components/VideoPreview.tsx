import React, { useState } from "react";
import { Camera, Monitor, Play, Square, Check } from "lucide-react";
import type { SourceMode } from "../types.ts";

interface VideoPreviewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  activeSource: SourceMode | "none";
  isStreaming: boolean;
  captureCount: number;
  onCapture: () => void;
  onStop: () => void;
  onStartScreen: () => void;
  onStartCamera: () => void;
  onGoToEditing?: () => void;
  error: string | null;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({
  videoRef,
  activeSource,
  isStreaming,
  captureCount,
  onCapture,
  onStop,
  onStartScreen,
  onStartCamera,
  onGoToEditing,
  error,
}) => {
  const [isFlashing, setIsFlashing] = useState(false);

  const handleCaptureClick = () => {
    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 200);
    onCapture();
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-slate-950 overflow-hidden select-none">
      {/* Video Element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`w-full h-full object-contain ${isStreaming ? "block" : "hidden"}`}
      />

      {/* Screen Flash on Capture */}
      {isFlashing && (
        <div className="absolute inset-0 bg-white/40 pointer-events-none z-30 transition-opacity" />
      )}

      {/* Placeholder / Empty State */}
      {!isStreaming && (
        <div className="flex flex-col items-center justify-center text-center p-8 max-w-md space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-indigo-400 shadow-xl">
            {activeSource === "camera" ? (
              <Camera className="w-8 h-8" />
            ) : (
              <Monitor className="w-8 h-8" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">
              キャプチャソースを選択してください
            </h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              画面の英文（ブラウザ・PDF・ゲーム等）を読みたいときは「画面共有」、洋書や紙の書類を読みたいときは「カメラ」を開始してください。複数ページを続けて取り込むこともできます。
            </p>
          </div>

          {error && (
            <div className="w-full bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs p-3 rounded-lg text-left">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onStartScreen}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
            >
              <Monitor className="w-4 h-4" />
              <span>画面共有を開始</span>
            </button>
            <button
              type="button"
              onClick={onStartCamera}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-all cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              <span>カメラを開始</span>
            </button>
          </div>
        </div>
      )}

      {/* Floating Controls Overlay when Streaming */}
      {isStreaming && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-slate-900/95 backdrop-blur-md px-4 py-2 rounded-full border border-slate-700/80 shadow-2xl z-20">
          <button
            type="button"
            onClick={handleCaptureClick}
            className="flex items-center gap-2 px-5 py-2 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white font-medium text-xs shadow-lg shadow-indigo-500/30 transition-all transform hover:scale-105 active:scale-95 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>
              {captureCount > 0 ? `続けてキャプチャ (${captureCount}枚目)` : "静止画をキャプチャ"}
            </span>
          </button>

          {captureCount > 0 && onGoToEditing && (
            <button
              type="button"
              onClick={onGoToEditing}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>完了・編集へ ({captureCount}枚)</span>
            </button>
          )}

          <button
            type="button"
            onClick={onStop}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-400 text-xs font-medium transition-all cursor-pointer"
            title="ストリームを停止"
          >
            <Square className="w-3 h-3" />
            <span>停止</span>
          </button>
        </div>
      )}
    </div>
  );
};
