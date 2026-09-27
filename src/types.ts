export type SourceMode = "screen" | "camera" | "file";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureItem {
  id: string;
  /** original image (served from /api/images/:id) */
  imageId: string;
  /** cropped image if cropped */
  croppedImageId?: string;
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

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  items: CaptureItem[];
  selectedId: string | null;
  ocrText: string;
  isOcrLoading: boolean;
  messages: ChatMessage[];
  isChatLoading: boolean;
  interactionId?: string;
}

/** SQLite に保存されるフォルダ（読み込み中などの一時的な状態は含まない） */
export interface StoredFolder {
  id: string;
  name: string;
  createdAt: number;
  sortOrder: number;
  selectedId: string | null;
  ocrText: string;
  interactionId?: string;
  items: CaptureItem[];
  messages: ChatMessage[];
}

/** フォルダの保存リクエスト。items / messages は変更があった場合のみ送る */
export type FolderPatch = Omit<StoredFolder, "items" | "messages"> & {
  items?: CaptureItem[];
  messages?: ChatMessage[];
};
