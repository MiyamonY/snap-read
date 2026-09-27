const ANNOTATE_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
/** images:annotate の1リクエストあたりの画像数の上限 */
const MAX_IMAGES_PER_REQUEST = 16;

type BreakType = "UNKNOWN" | "SPACE" | "SURE_SPACE" | "EOL_SURE_SPACE" | "HYPHEN" | "LINE_BREAK";

interface VisionSymbol {
  text: string;
  property?: { detectedBreak?: { type: BreakType } };
}

interface VisionParagraph {
  words?: { symbols?: VisionSymbol[] }[];
}

interface VisionBlock {
  blockType?: string;
  paragraphs?: VisionParagraph[];
}

interface AnnotateResponse {
  responses?: {
    fullTextAnnotation?: { pages?: { blocks?: VisionBlock[] }[] };
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

/** 1枚分の OCR 結果を、段落ごとに空行で区切ったテキストにする */
const annotationText = (pages: { blocks?: VisionBlock[] }[]): string =>
  pages
    .flatMap((page) => page.blocks ?? [])
    .filter((block) => !block.blockType || block.blockType === "TEXT")
    .flatMap((block) => block.paragraphs ?? [])
    .map((paragraph) => paragraphText(paragraph))
    .filter(Boolean)
    .join("\n\n");

/**
 * Google Cloud Vision（DOCUMENT_TEXT_DETECTION）で画像内の文字を読み取る。
 * 利用者の OAuth トークン（cloud-vision スコープ）で呼ぶ。
 * 複数枚の場合は画像ごとに [画像N] の見出しを付ける
 */
export const recognizeText = async (accessToken: string, images: Uint8Array[]): Promise<string> => {
  const texts: string[] = [];
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
      texts.push(annotationText(response.fullTextAnnotation?.pages ?? []));
    }
  }

  return texts.length > 1
    ? texts.map((text, i) => `[画像${i + 1}]\n\n${text}`).join("\n\n")
    : (texts[0] ?? "");
};
