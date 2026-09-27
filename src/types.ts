export type SourceMode = "screen" | "camera" | "file";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureItem {
  id: string;
  /** original raw data URL */
  dataUrl: string;
  /** cropped data URL if cropped */
  croppedDataUrl?: string;
  thumbnailUrl: string;
  source: SourceMode;
  timestamp: number;
}

export type AnalysisPreset = "translate" | "grammar" | "vocab" | "summary" | "custom";

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: number;
  preset?: AnalysisPreset;
}

export interface WordDefinition {
  word: string;
  partOfSpeech: string;
  meaning: string;
  detail: string;
  phonetic?: string;
}

export interface AppSettings {
  apiKey: string;
  model: string;
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  thumbnailUrl: string;
  fullDataUrl: string;
  messages: ChatMessage[];
  presetTitle: string;
}
