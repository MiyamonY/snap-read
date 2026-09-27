import React, { useState, useEffect } from "react";
import { Loader2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Header } from "./components/Header.tsx";
import { VideoPreview } from "./components/VideoPreview.tsx";
import { ImageCropper } from "./components/ImageCropper.tsx";
import { AnalysisPanel } from "./components/AnalysisPanel.tsx";
import { ApiKeyModal } from "./components/ApiKeyModal.tsx";
import { ImageTray } from "./components/ImageTray.tsx";
import { FolderBar } from "./components/FolderBar.tsx";
import { useMediaStream } from "./hooks/useMediaStream.ts";
import { useFolders } from "./hooks/useFolders.ts";
import { useFolderWords } from "./hooks/useFolderWords.ts";
import { aiService, DEFAULT_MODEL, isResponseId } from "./services/ai.ts";
import { imageApi, itemImageUrl } from "./services/imageApi.ts";
import { normalizeOcrText } from "./services/ocrText.ts";
import { recognizeImages } from "./services/ocrApi.ts";
import { errorMessage } from "./utils.ts";
import type { AnalysisPreset, ChatMessage, CaptureItem, Folder, MainTab } from "./types.ts";

/** AI に送るため、フォルダ内の画像を data URL で取得する */
const loadImagesForAi = (folder: Folder) =>
  Promise.all(folder.items.map((it) => imageApi.fetchAsDataUrl(itemImageUrl(it))));

/** Google ドライブ接続（OAuth コールバック）で失敗した場合のエラー */
const driveErrorFromUrl = () => {
  const error = new URLSearchParams(globalThis.location.search).get("drive_error");
  return error ? `Google ドライブへの接続に失敗しました: ${error}` : null;
};

const SIDEBAR_STORAGE_KEY = "snapread_capture_sidebar";
/** OpenAI の API キー（Gemini のキーを保存していた snapread_api_key とは別に持つ） */
const API_KEY_STORAGE_KEY = "snapread_openai_api_key";

const newId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export const App: React.FC = () => {
  // API Key state
  const [apiKey, setApiKey] = useState<string>(() => {
    return (
      localStorage.getItem(API_KEY_STORAGE_KEY) ||
      (import.meta as ImportMeta & { env?: { VITE_OPENAI_API_KEY?: string } }).env
        ?.VITE_OPENAI_API_KEY ||
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

  // Folders (each holds its own images, OCR text and chat history; persisted in SQLite)
  const {
    folders,
    activeFolder: folder,
    isLoaded,
    storageError,
    updateFolder,
    addFolder,
    selectFolder,
    renameFolder,
    deleteFolder,
  } = useFolders();
  const vocabulary = useFolderWords(folder?.id);
  const [viewMode, setViewMode] = useState<"stream" | "crop">("stream");
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    () => localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "closed",
  );
  const [notice, setNotice] = useState<string | null>(driveErrorFromUrl);
  const [activeTab, setActiveTab] = useState<MainTab>("reader");

  // OAuth コールバックで付与されたクエリを URL から取り除く
  useEffect(() => {
    if (globalThis.location.search.includes("drive_error")) {
      globalThis.history.replaceState(null, "", globalThis.location.pathname);
    }
  }, []);

  // Initialize AI Service when API Key changes
  useEffect(() => {
    if (apiKey) {
      aiService.init(apiKey);
    }
  }, [apiKey]);

  if (!isLoaded || !folder) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-slate-950 text-slate-400 gap-2 text-sm">
        <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
        <span>フォルダを読み込んでいます...</span>
      </div>
    );
  }

  const folderId = folder.id;

  const setSidebarOpen = (open: boolean) => {
    setIsSidebarOpen(open);
    localStorage.setItem(SIDEBAR_STORAGE_KEY, open ? "open" : "closed");
  };
  const { items, selectedId } = folder;

  const handleSaveApiKey = (newKey: string) => {
    setApiKey(newKey);
    localStorage.setItem(API_KEY_STORAGE_KEY, newKey);
    aiService.init(newKey);
  };

  const handleSelectFolder = (id: string) => {
    selectFolder(id);
    const target = folders.find((f) => f.id === id);
    setViewMode(target && target.items.length > 0 ? "crop" : "stream");
  };

  const handleAddFolder = () => {
    addFolder();
    setViewMode("stream");
  };

  const handleDeleteFolder = (id: string) => {
    deleteFolder(id);
    if (id === folderId) {
      setViewMode("stream");
    }
  };

  // OCR Extraction function
  const handleExtractOcr = async () => {
    if (items.length === 0) return;

    if (!apiKey) {
      setIsApiKeyModalOpen(true);
      return;
    }

    updateFolder(folderId, (f) => ({ ...f, isOcrLoading: true }));
    let ocrText: string;
    try {
      // Google Cloud Vision で文字認識し、GPT-6 Luna で本文以外を除いて段落を整える
      const rawText = await recognizeImages(items.map((it) => it.croppedImageId ?? it.imageId));
      ocrText = normalizeOcrText(await aiService.cleanupOcrText(rawText, DEFAULT_MODEL));
    } catch (err) {
      console.error("OCR extraction failed:", err);
      ocrText = `⚠️ テキスト抽出エラー: ${errorMessage(err)}`;
    }
    updateFolder(folderId, (f) => ({ ...f, ocrText, isOcrLoading: false }));
  };

  const addItems = (newItems: CaptureItem[]) => {
    updateFolder(folderId, (f) => ({
      ...f,
      items: [...f.items, ...newItems],
      selectedId: f.selectedId ?? newItems[0]?.id ?? null,
    }));
  };

  // Capture current video frame into items
  const handleCapture = async () => {
    const frame = captureFrame();
    if (!frame) return;
    try {
      const imageId = await imageApi.uploadDataUrl(folderId, frame);
      const newItem: CaptureItem = {
        id: newId("cap"),
        imageId,
        source: activeSource === "none" ? "screen" : activeSource,
        timestamp: Date.now(),
      };
      addItems([newItem]);
      updateFolder(folderId, (f) => ({ ...f, selectedId: newItem.id }));
    } catch (err) {
      setNotice(`画像の保存に失敗しました: ${errorMessage(err)}`);
    }
  };

  // Load images from file input
  const handleSelectFiles = async (fileList: FileList) => {
    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    try {
      const imageIds = await Promise.all(files.map((file) => imageApi.upload(folderId, file)));
      addItems(
        imageIds.map((imageId) => ({
          id: newId("file"),
          imageId,
          source: "file",
          timestamp: Date.now(),
        })),
      );
      setViewMode("crop");
    } catch (err) {
      setNotice(`画像の保存に失敗しました: ${errorMessage(err)}`);
    }
  };

  // Select an item to view / crop
  const handleSelectItem = (id: string) => {
    updateFolder(folderId, (f) => ({ ...f, selectedId: id }));
    setViewMode("crop");
  };

  // Delete an item
  const handleDeleteItem = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const remaining = items.filter((item) => item.id !== id);
    updateFolder(folderId, (f) => {
      const filtered = f.items.filter((item) => item.id !== id);
      return {
        ...f,
        items: filtered,
        selectedId: f.selectedId === id ? (filtered.at(-1)?.id ?? null) : f.selectedId,
        ocrText: filtered.length === 0 ? "" : f.ocrText,
      };
    });
    if (remaining.length === 0) {
      setViewMode("stream");
    }
  };

  // Clear all items in the current folder
  const handleClearAll = () => {
    updateFolder(folderId, (f) => ({
      ...f,
      items: [],
      selectedId: null,
      ocrText: "",
      messages: [],
      interactionId: undefined,
    }));
    setViewMode("stream");
  };

  // Apply crop to currently selected item
  const handleApplyCropToCurrent = async (croppedDataUrl: string | null) => {
    if (!selectedId || !croppedDataUrl) return;
    try {
      const croppedImageId = await imageApi.uploadDataUrl(folderId, croppedDataUrl);
      updateFolder(folderId, (f) => ({
        ...f,
        items: f.items.map((item) => (item.id === selectedId ? { ...item, croppedImageId } : item)),
      }));
    } catch (err) {
      setNotice(`切り抜き画像の保存に失敗しました: ${errorMessage(err)}`);
    }
  };

  // Navigate between images
  const currentIndex = items.findIndex((it) => it.id === selectedId);
  const handlePrevItem = () => {
    if (currentIndex > 0) {
      handleSelectItem(items[currentIndex - 1].id);
    }
  };

  const handleNextItem = () => {
    if (currentIndex >= 0 && currentIndex < items.length - 1) {
      handleSelectItem(items[currentIndex + 1].id);
    }
  };

  // Return to stream view to capture more
  const handleAddMore = () => {
    setViewMode("stream");
  };

  // Selected item object
  const currentItem = items.find((it) => it.id === selectedId) || items[0];

  /** ユーザーメッセージと空のモデル応答を追加し、応答をストリーミングで書き込む */
  const runChat = async (
    userText: string,
    preset: AnalysisPreset | undefined,
    request: (onChunk: (chunk: string) => void) => Promise<{ interactionId?: string }>,
  ) => {
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: userText,
      timestamp: Date.now(),
      preset,
    };
    const modelMsgId = `model-${Date.now()}`;
    const updateModelText = (update: (text: string) => string) => {
      updateFolder(folderId, (f) => ({
        ...f,
        messages: f.messages.map((msg) =>
          msg.id === modelMsgId ? { ...msg, text: update(msg.text) } : msg,
        ),
      }));
    };

    updateFolder(folderId, (f) => ({
      ...f,
      isChatLoading: true,
      messages: [
        ...f.messages,
        userMsg,
        { id: modelMsgId, role: "model", text: "", timestamp: Date.now() },
      ],
    }));

    let interactionId: string | undefined;
    try {
      ({ interactionId } = await request((chunk) => updateModelText((text) => text + chunk)));
    } catch (err) {
      const message = errorMessage(err);
      updateModelText(() => `⚠️ エラーが発生しました: ${message}`);
    }
    updateFolder(folderId, (f) => ({
      ...f,
      isChatLoading: false,
      interactionId: interactionId ?? f.interactionId,
    }));
  };

  // Execute AI Preset Analysis (Multiple Images)
  const handleExecutePreset = async (preset: AnalysisPreset, prompt: string) => {
    if (items.length === 0) return;

    if (!apiKey) {
      setIsApiKeyModalOpen(true);
      return;
    }

    const presetLabels: Record<AnalysisPreset, string> = {
      translate: items.length > 1 ? `📝 全 ${items.length} 枚を一括翻訳` : "📝 全文翻訳を実行",
      grammar: "🔍 構文・文法解説を実行",
      vocab: "📚 重要単語・熟語を抽出",
      summary: items.length > 1 ? `💡 全 ${items.length} 枚を要約` : "💡 要約・要点を整理",
      custom: prompt,
    };

    await runChat(presetLabels[preset] || prompt, preset, async (onChunk) =>
      aiService.analyzeImagesStream(await loadImagesForAi(folder), prompt, onChunk, DEFAULT_MODEL),
    );
  };

  // Follow-up chat message
  const handleSendMessage = async (text: string) => {
    if (items.length === 0 || !text.trim()) return;

    if (!apiKey) {
      setIsApiKeyModalOpen(true);
      return;
    }

    // Gemini 時代に保存された会話 ID では続けられないため、画像付きで新しく会話を始める
    const interactionId = isResponseId(folder.interactionId) ? folder.interactionId : undefined;
    await runChat(text, undefined, async (onChunk) =>
      interactionId
        ? aiService.continueChatStream(text, interactionId, onChunk, DEFAULT_MODEL)
        : aiService.analyzeImagesStream(
            await loadImagesForAi(folder),
            text,
            onChunk,
            DEFAULT_MODEL,
          ),
    );
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Top Header */}
      <Header
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        hasOcrText={!!folder.ocrText}
        vocabularyCount={vocabulary.words.length}
        onOpenSettings={() => setIsApiKeyModalOpen(true)}
        hasApiKey={!!apiKey}
      />

      {(storageError || notice) && (
        <div className="px-4 py-1.5 bg-rose-950/60 border-b border-rose-900 text-xs text-rose-200 shrink-0 flex items-center justify-between gap-2">
          <span>⚠️ {notice ?? storageError}</span>
          {notice && (
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-rose-300 hover:text-white cursor-pointer"
            >
              閉じる
            </button>
          )}
        </div>
      )}

      {/* Main Split Layout: Left = Analysis & Results (Large), Right = Capture Source */}
      <div className="flex flex-1 min-h-0">
        {/* LEFT: AI Analysis, Interactive Reader & Results (Larger Area) */}
        <div className="flex-1 h-full min-w-0 bg-slate-900 border-r border-slate-800">
          <AnalysisPanel
            key={folderId}
            items={items}
            messages={folder.messages}
            isLoading={folder.isChatLoading}
            onExecutePreset={handleExecutePreset}
            onSendMessage={handleSendMessage}
            activeTab={activeTab}
            ocrText={folder.ocrText}
            isOcrLoading={folder.isOcrLoading}
            onExtractOcr={handleExtractOcr}
            vocabulary={{
              words: vocabulary.words,
              savedWords: vocabulary.savedWords,
              isLoading: vocabulary.isLoading,
              error: vocabulary.error,
              onSave: vocabulary.addWord,
              onRemove: vocabulary.removeWord,
              onSelectFolder: handleSelectFolder,
            }}
          />
        </div>

        {/* RIGHT (collapsed): thin rail to reopen the capture panel */}
        {!isSidebarOpen && (
          <div className="w-11 h-full shrink-0 flex flex-col items-center gap-3 py-2 bg-slate-950 border-l border-slate-800">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              title="キャプチャパネルを開く"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <PanelRightOpen className="w-4 h-4" />
            </button>
            {isStreaming && (
              <span
                className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"
                title="キャプチャ中"
              />
            )}
            <span className="text-[11px] text-slate-400 [writing-mode:vertical-rl] tracking-wider">
              {folder.name}・{items.length} 枚
            </span>
          </div>
        )}

        {/* RIGHT: Capture Source & Image Tray (Wider Panel ~480px).
            閉じている間も映像ストリームを保つため、アンマウントせず非表示にする */}
        <div
          className={`w-[480px] max-w-[45vw] h-full flex-col bg-slate-950 shrink-0 ${
            isSidebarOpen ? "flex" : "hidden"
          }`}
        >
          {/* Collapse button & Folder Tabs */}
          <div className="flex items-stretch">
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              title="キャプチャパネルを閉じる"
              className="h-10 px-2.5 shrink-0 border-b border-r border-slate-800 bg-slate-900/90 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
            <div className="flex-1 min-w-0">
              <FolderBar
                folders={folders}
                activeFolderId={folderId}
                onSelect={handleSelectFolder}
                onAdd={handleAddFolder}
                onRename={renameFolder}
                onDelete={handleDeleteFolder}
              />
            </div>
          </div>

          {/* Main Visual: Stream or Cropper */}
          <div className="flex-1 relative min-h-0">
            {viewMode === "crop" && currentItem ? (
              <ImageCropper
                imageUrl={itemImageUrl(currentItem)}
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
                onSelectFiles={handleSelectFiles}
                onGoToEditing={() => {
                  const lastItem = items.at(-1);
                  if (lastItem) {
                    handleSelectItem(lastItem.id);
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
