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

/** フォルダの単語帳に登録された単語（語義はフォルダ内の文脈に応じたもの） */
export interface VocabularyEntry {
  word: string;
  phonetic?: string;
  partOfSpeech: string;
  meaning: string;
  detail: string;
  /** 単語が出てきた文 */
  context: string;
  addedAt: number;
  /** 同じ単語を登録している他のフォルダ */
  otherFolders: { id: string; name: string }[];
}

/** 単語帳への登録リクエスト */
export type VocabularyInput = Omit<VocabularyEntry, "word" | "addedAt" | "otherFolders">;

/** メイン画面のタブ（テキスト読解 / 単語帳） */
export type MainTab = "reader" | "vocab";

/** OCR で認識した単語と、画像内での位置（画像の幅・高さに対する 0〜1 の割合） */
export interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 所属する段落（OcrLayout.paragraphs の添字） */
  paragraph: number;
}

/** 1枚の画像の OCR 結果のレイアウト（画像上にテキストを重ねるために使う） */
export interface OcrLayout {
  paragraphs: string[];
  words: OcrWord[];
}
