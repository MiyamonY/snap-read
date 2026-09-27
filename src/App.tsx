import React, { useState, useEffect, useCallback } from "react";
import { Header } from "./components/Header.tsx";
import { VideoPreview } from "./components/VideoPreview.tsx";
import { ImageCropper } from "./components/ImageCropper.tsx";
import { AnalysisPanel } from "./components/AnalysisPanel.tsx";
import { ApiKeyModal } from "./components/ApiKeyModal.tsx";
import { ImageTray } from "./components/ImageTray.tsx";
import { useMediaStream } from "./hooks/useMediaStream.ts";
import { geminiService, DEFAULT_MODEL } from "./services/gemini.ts";
import { AnalysisPreset, ChatMessage, CaptureItem } from "./types.ts";

export const App: React.FC = () => {
  // API Key state
  const [apiKey, setApiKey] = useState<string>(() => {
    return (
      localStorage.getItem("snapread_api_key") ||
      localStorage.getItem("maganize_api_key") ||
      (import.meta as any).env?.VITE_GEMINI_API_KEY ||
      ""
    );
  });
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);

  // Media capture hook
  const {
    activeSource,
    isStreaming,
    error: mediaError,
    videoRef,
    startScreenCapture,
    startCameraCapture,
    stopStream,
    captureFrame,
  } = useMediaStream();

  // Multiple captured images list
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"stream" | "crop">("stream");

  // OCR state
  const [ocrText, setOcrText] = useState<string>("");
  const [isOcrLoading, setIsOcrLoading] = useState(false);

  // Gemini chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [interactionId, setInteractionId] = useState<string | undefined>(undefined);

  // Initialize Gemini Service when API Key changes
  useEffect(() => {
    if (apiKey) {
      geminiService.init(apiKey);
    }
  }, [apiKey]);

  const handleSaveApiKey = (newKey: string) => {
    setApiKey(newKey);
    localStorage.setItem("snapread_api_key", newKey);
    geminiService.init(newKey);
  };

  // OCR Extraction function
  const handleExtractOcr = useCallback(async () => {
    if (items.length === 0) return;

    if (!apiKey) {
      setIsApiKeyModalOpen(true);
      return;
    }

    setIsOcrLoading(true);
    const imagesToExtract = items.map((it) => it.croppedDataUrl || it.dataUrl);

    try {
      const extracted = await geminiService.extractTextFromImages(imagesToExtract, DEFAULT_MODEL);
      setOcrText(extracted);
    } catch (err: any) {
      console.error("OCR extraction failed:", err);
      setOcrText(`⚠️ テキスト抽出エラー: ${err.message || String(err)}`);
    } finally {
      setIsOcrLoading(false);
    }
  }, [items, apiKey]);

  // Capture current video frame into items
  const handleCapture = useCallback(() => {
    const frame = captureFrame();
    if (frame) {
      const newItem: CaptureItem = {
        id: `cap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        dataUrl: frame,
        thumbnailUrl: frame,
        source: activeSource === "none" ? "screen" : activeSource,
        timestamp: Date.now(),
      };

      setItems((prev) => [...prev, newItem]);
      setSelectedId(newItem.id);
    }
  }, [captureFrame, activeSource]);

  // Load images from file input
  const handleSelectFiles = useCallback(
    (fileList: FileList) => {
      const fileArray = Array.from(fileList);
      if (fileArray.length === 0) return;

      fileArray.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          if (dataUrl) {
            const newItem: CaptureItem = {
              id: `file-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
              dataUrl,
              thumbnailUrl: dataUrl,
              source: "file",
              timestamp: Date.now(),
            };
            setItems((prev) => {
              const next = [...prev, newItem];
              if (!selectedId) {
                setSelectedId(newItem.id);
              }
              return next;
            });
            setViewMode("crop");
          }
        };
        reader.readAsDataURL(file);
      });
    },
    [selectedId],
  );

  // Select an item to view / crop
  const handleSelectItem = useCallback((id: string) => {
    setSelectedId(id);
    setViewMode("crop");
  }, []);

  // Delete an item
  const handleDeleteItem = useCallback(
    (id: string, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      setItems((prev) => {
        const filtered = prev.filter((item) => item.id !== id);
        if (selectedId === id) {
          setSelectedId(filtered.length > 0 ? filtered[filtered.length - 1].id : null);
          if (filtered.length === 0) {
            setViewMode("stream");
            setOcrText("");
          }
        }
        return filtered;
      });
    },
    [selectedId],
  );

  // Clear all items
  const handleClearAll = useCallback(() => {
    setItems([]);
    setSelectedId(null);
    setViewMode("stream");
    setOcrText("");
    setMessages([]);
    setInteractionId(undefined);
  }, []);

  // Apply crop to currently selected item
  const handleApplyCropToCurrent = useCallback(
    (croppedDataUrl: string) => {
      if (!selectedId) return;
      setItems((prev) =>
        prev.map((item) => (item.id === selectedId ? { ...item, croppedDataUrl } : item)),
      );
    },
    [selectedId],
  );

  // Navigate between images
  const currentIndex = items.findIndex((it) => it.id === selectedId);
  const handlePrevItem = useCallback(() => {
    if (currentIndex > 0) {
      setSelectedId(items[currentIndex - 1].id);
    }
  }, [currentIndex, items]);

  const handleNextItem = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < items.length - 1) {
      setSelectedId(items[currentIndex + 1].id);
    }
  }, [currentIndex, items]);

  // Return to stream view to capture more
  const handleAddMore = useCallback(() => {
    setViewMode("stream");
  }, []);

  // Reset analysis messages
  const handleResetAnalysis = useCallback(() => {
    setMessages([]);
    setInteractionId(undefined);
    setOcrText("");
  }, []);

  // Selected item object
  const currentItem = items.find((it) => it.id === selectedId) || items[0];

  // Execute Gemini Preset Analysis (Multiple Images)
  const handleExecutePreset = async (preset: AnalysisPreset, prompt: string) => {
    if (items.length === 0) return;

    if (!apiKey) {
      setIsApiKeyModalOpen(true);
      return;
    }

    setIsLoading(true);
    const userMsgId = `user-${Date.now()}`;
    const modelMsgId = `model-${Date.now()}`;

    const presetLabels: Record<AnalysisPreset, string> = {
      translate: items.length > 1 ? `📝 全 ${items.length} 枚を一括翻訳` : "📝 全文翻訳を実行",
      grammar: "🔍 構文・文法解説を実行",
      vocab: "📚 重要単語・熟語を抽出",
      summary: items.length > 1 ? `💡 全 ${items.length} 枚を要約` : "💡 要約・要点を整理",
      custom: prompt,
    };

    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        text: presetLabels[preset] || prompt,
        timestamp: Date.now(),
        preset,
      },
      {
        id: modelMsgId,
        role: "model",
        text: "",
        timestamp: Date.now(),
      },
    ]);

    const imagesToAnalyze = items.map((it) => it.croppedDataUrl || it.dataUrl);

    try {
      const result = await geminiService.analyzeImagesStream(
        imagesToAnalyze,
        prompt,
        (chunk) => {
          setMessages((prev) =>
            prev.map((msg) => (msg.id === modelMsgId ? { ...msg, text: msg.text + chunk } : msg)),
          );
        },
        DEFAULT_MODEL,
      );

      if (result.interactionId) {
        setInteractionId(result.interactionId);
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === modelMsgId
            ? { ...msg, text: `⚠️ エラーが発生しました: ${err.message || String(err)}` }
            : msg,
        ),
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Follow-up chat message
  const handleSendMessage = async (text: string) => {
    if (items.length === 0 || !text.trim()) return;

    if (!apiKey) {
      setIsApiKeyModalOpen(true);
      return;
    }

    setIsLoading(true);
    const userMsgId = `user-${Date.now()}`;
    const modelMsgId = `model-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        text,
        timestamp: Date.now(),
      },
      {
        id: modelMsgId,
        role: "model",
        text: "",
        timestamp: Date.now(),
      },
    ]);

    try {
      if (interactionId) {
        const result = await geminiService.continueChatStream(
          text,
          interactionId,
          (chunk) => {
            setMessages((prev) =>
              prev.map((msg) => (msg.id === modelMsgId ? { ...msg, text: msg.text + chunk } : msg)),
            );
          },
          DEFAULT_MODEL,
        );
        if (result.interactionId) {
          setInteractionId(result.interactionId);
        }
      } else {
        const imagesToAnalyze = items.map((it) => it.croppedDataUrl || it.dataUrl);
        const result = await geminiService.analyzeImagesStream(
          imagesToAnalyze,
          text,
          (chunk) => {
            setMessages((prev) =>
              prev.map((msg) => (msg.id === modelMsgId ? { ...msg, text: msg.text + chunk } : msg)),
            );
          },
          DEFAULT_MODEL,
        );
        if (result.interactionId) {
          setInteractionId(result.interactionId);
        }
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === modelMsgId
            ? { ...msg, text: `⚠️ エラーが発生しました: ${err.message || String(err)}` }
            : msg,
        ),
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Top Header */}
      <Header
        activeSource={activeSource}
        onSelectScreen={startScreenCapture}
        onSelectCamera={startCameraCapture}
        onSelectFiles={handleSelectFiles}
        onOpenSettings={() => setIsApiKeyModalOpen(true)}
        hasApiKey={!!apiKey}
      />

      {/* Main Split Layout: Left = Analysis & Results (Large), Right = Capture Source */}
      <div className="flex flex-1 min-h-0">
        {/* LEFT: Gemini Analysis, Interactive Reader & Results (Larger Area) */}
        <div className="flex-1 h-full min-w-0 bg-slate-900 border-r border-slate-800">
          <AnalysisPanel
            items={items}
            messages={messages}
            isLoading={isLoading}
            onExecutePreset={handleExecutePreset}
            onSendMessage={handleSendMessage}
            onReset={handleResetAnalysis}
            selectedId={selectedId}
            onSelectImage={handleSelectItem}
            ocrText={ocrText}
            isOcrLoading={isOcrLoading}
            onExtractOcr={handleExtractOcr}
          />
        </div>

        {/* RIGHT: Capture Source & Image Tray (Wider Panel ~480px) */}
        <div className="w-[480px] max-w-[45vw] h-full flex flex-col bg-slate-950 shrink-0">
          {/* Main Visual: Stream or Cropper */}
          <div className="flex-1 relative min-h-0">
            {viewMode === "crop" && currentItem ? (
              <ImageCropper
                imageDataUrl={currentItem.croppedDataUrl || currentItem.dataUrl}
                currentIndex={Math.max(0, currentIndex)}
                totalCount={items.length}
                onApplyCropToCurrent={handleApplyCropToCurrent}
                onAddMore={handleAddMore}
                onPrev={handlePrevItem}
                onNext={handleNextItem}
                onDeleteCurrent={() => handleDeleteItem(currentItem.id)}
              />
            ) : (
              <VideoPreview
                videoRef={videoRef}
                activeSource={activeSource}
                isStreaming={isStreaming}
                captureCount={items.length}
                onCapture={handleCapture}
                onStop={stopStream}
                onStartScreen={startScreenCapture}
                onStartCamera={startCameraCapture}
                onGoToEditing={() => {
                  if (items.length > 0) {
                    setSelectedId(items[items.length - 1].id);
                    setViewMode("crop");
                  }
                }}
                error={mediaError}
              />
            )}
          </div>

          {/* Bottom Thumbnail Tray for Multi-image Collection */}
          <ImageTray
            items={items}
            selectedId={selectedId}
            onSelect={handleSelectItem}
            onDelete={handleDeleteItem}
            onClearAll={handleClearAll}
            onAddNew={handleAddMore}
            isStreaming={isStreaming && viewMode === "stream"}
          />
        </div>
      </div>

      {/* Settings Modal */}
      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        apiKey={apiKey}
        onSaveApiKey={handleSaveApiKey}
      />
    </div>
  );
};
