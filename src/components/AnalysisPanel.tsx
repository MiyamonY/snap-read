import React, { useState } from "react";
import type {
  AnalysisPreset,
  ChatMessage,
  CaptureItem,
  MainTab,
  VocabularyEntry,
  VocabularyInput,
} from "../types.ts";
import { InteractiveReader } from "./InteractiveReader.tsx";
import { VocabularyList } from "./VocabularyList.tsx";
import { AiChatPanel } from "./AiChatPanel.tsx";

const AI_PANEL_STORAGE_KEY = "snapread_ai_panel";

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
  activeTab: MainTab;
  ocrText: string;
  isOcrLoading: boolean;
  onExtractOcr: () => void;
  vocabulary: VocabularyProps;
}

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({
  items,
  messages,
  isLoading,
  onExecutePreset,
  onSendMessage,
  activeTab,
  ocrText,
  isOcrLoading,
  onExtractOcr,
  vocabulary,
}) => {
  const [isAiOpen, setIsAiOpen] = useState(
    () => localStorage.getItem(AI_PANEL_STORAGE_KEY) !== "closed",
  );

  const setAiOpen = (open: boolean) => {
    setIsAiOpen(open);
    localStorage.setItem(AI_PANEL_STORAGE_KEY, open ? "open" : "closed");
  };

  // AI の応答が届いたら（プリセット実行・質問時）、チャットダイアログを開いて表示する
  const [prevMessageCount, setPrevMessageCount] = useState(messages.length);
  if (prevMessageCount !== messages.length) {
    setPrevMessageCount(messages.length);
    if (messages.length > prevMessageCount) {
      setIsAiOpen(true);
    }
  }

  const handleAskAboutWord = (word: string, meaning: string) => {
    setAiOpen(true);
    onSendMessage(
      `単語「${word}」（意味: ${meaning}）について、この画像文脈における詳しい用法・ニュアンス・例文を解説してください。`,
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 w-full overflow-hidden">
      {/* Main Tab Content (AI chat floats over it) */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        {activeTab === "reader" ? (
          <InteractiveReader
            ocrText={ocrText}
            isOcrLoading={isOcrLoading}
            onExtractOcr={onExtractOcr}
            onAskAboutWord={handleAskAboutWord}
            items={items}
            savedWords={vocabulary.savedWords}
            onSaveWord={vocabulary.onSave}
            onRemoveWord={vocabulary.onRemove}
          />
        ) : (
          <VocabularyList
            words={vocabulary.words}
            isLoading={vocabulary.isLoading}
            error={vocabulary.error}
            onRemove={vocabulary.onRemove}
            onSelectFolder={vocabulary.onSelectFolder}
          />
        )}
        <AiChatPanel
          items={items}
          messages={messages}
          isLoading={isLoading}
          onExecutePreset={onExecutePreset}
          onSendMessage={onSendMessage}
          isOpen={isAiOpen}
          onToggle={() => setAiOpen(!isAiOpen)}
        />
      </div>
    </div>
  );
};
