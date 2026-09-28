import type { OcrLayout, OcrWord } from "../src/types.ts";

const ANNOTATE_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
/** images:annotate の1リクエストあたりの画像数の上限 */
const MAX_IMAGES_PER_REQUEST = 16;

type BreakType = "UNKNOWN" | "SPACE" | "SURE_SPACE" | "EOL_SURE_SPACE" | "HYPHEN" | "LINE_BREAK";

interface VisionSymbol {
  text: string;
  property?: { detectedBreak?: { type: BreakType } };
}

interface BoundingPoly {
  /** 座標が 0 の場合は x / y が省略される */
  vertices?: { x?: number; y?: number }[];
}

interface VisionWord {
  boundingBox?: BoundingPoly;
  symbols?: VisionSymbol[];
}

interface VisionParagraph {
  words?: VisionWord[];
}

interface VisionBlock {
  blockType?: string;
  paragraphs?: VisionParagraph[];
}

interface VisionPage {
  width?: number;
  height?: number;
  blocks?: VisionBlock[];
}

interface AnnotateResponse {
  responses?: {
    fullTextAnnotation?: { pages?: VisionPage[] };
    error?: { message: string };
  }[];
}

const BREAK_TEXT: Record<BreakType, string> = {
  UNKNOWN: "",
  SPACE: " ",
  SURE_SPACE: " ",
  // 行の折り返し
  EOL_SURE_SPACE: " ",
  // 本文には含まれない行末のハイフン（単語が行をまたいでいる）
  HYPHEN: "",
  LINE_BREAK: "\n",
};

/** Vision の段落を、文字と改行の種別からテキストに組み立てる */
const paragraphText = (paragraph: VisionParagraph): string => {
  let text = "";
  for (const word of paragraph.words ?? []) {
    for (const symbol of word.symbols ?? []) {
      text += symbol.text;
      const breakType = symbol.property?.detectedBreak?.type;
      if (breakType) text += BREAK_TEXT[breakType];
    }
  }
  return text.trim();
};

const textParagraphs = (page: VisionPage): VisionParagraph[] =>
  (page.blocks ?? [])
    .filter((block) => !block.blockType || block.blockType === "TEXT")
    .flatMap((block) => block.paragraphs ?? []);

/** 単語の外接矩形を、ページ（画像）の幅・高さに対する割合で返す */
const wordBox = (word: VisionWord, page: VisionPage) => {
  const vertices = word.boundingBox?.vertices ?? [];
  if (vertices.length === 0 || !page.width || !page.height) return;
  const xs = vertices.map((v) => v.x ?? 0);
  const ys = vertices.map((v) => v.y ?? 0);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    x: left / page.width,
    y: top / page.height,
    w: (Math.max(...xs) - left) / page.width,
    h: (Math.max(...ys) - top) / page.height,
  };
};

/** 1枚分の OCR 結果から、段落ごとに空行で区切ったテキストと、単語の位置を取り出す */
const annotate = (pages: VisionPage[]): { text: string; layout: OcrLayout } => {
  const layout: OcrLayout = { paragraphs: [], words: [] };
  for (const page of pages) {
    for (const paragraph of textParagraphs(page)) {
      const text = paragraphText(paragraph);
      if (!text) continue;
      const index = layout.paragraphs.push(text) - 1;
      for (const word of paragraph.words ?? []) {
        const box = wordBox(word, page);
        const wordText = (word.symbols ?? []).map((symbol) => symbol.text).join("");
        if (box && wordText) {
          layout.words.push({ text: wordText, ...box, paragraph: index } satisfies OcrWord);
        }
      }
    }
  }
  return { text: layout.paragraphs.join("\n\n"), layout };
};

/**
 * Google Cloud Vision（DOCUMENT_TEXT_DETECTION）で画像内の文字を読み取る。
 * 利用者の OAuth トークン（cloud-vision スコープ）で呼ぶ。
 * 複数枚の場合はテキストに画像ごとの [画像N] の見出しを付ける。layouts は images と同じ順
 */
export const recognizeText = async (
  accessToken: string,
  images: Uint8Array[],
): Promise<{ text: string; layouts: OcrLayout[] }> => {
  const texts: string[] = [];
  const layouts: OcrLayout[] = [];
  for (let offset = 0; offset < images.length; offset += MAX_IMAGES_PER_REQUEST) {
    const batch = images.slice(offset, offset + MAX_IMAGES_PER_REQUEST);
    const res = await fetch(ANNOTATE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        requests: batch.map((data) => ({
          image: { content: Buffer.from(data).toString("base64") },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          imageContext: { languageHints: ["en"] },
        })),
      }),
    });
    if (!res.ok) {
      throw new Error(`Cloud Vision API error: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as AnnotateResponse;
    for (const response of json.responses ?? []) {
      if (response.error) {
        throw new Error(`Cloud Vision API error: ${response.error.message}`);
      }
      const { text, layout } = annotate(response.fullTextAnnotation?.pages ?? []);
      texts.push(text);
      layouts.push(layout);
    }
  }

  const text =
    texts.length > 1
      ? texts.map((t, i) => `[画像${i + 1}]\n\n${t}`).join("\n\n")
      : (texts[0] ?? "");
  return { text, layouts };
};
