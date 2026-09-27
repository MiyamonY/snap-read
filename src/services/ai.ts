import OpenAI from "openai";
import type {
  ResponseInputContent,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";
import type { AnalysisPreset, WordDefinition } from "../types.ts";
import { errorMessage } from "../utils.ts";

export const DEFAULT_MODEL = "gpt-6-luna";
export const MODEL_LABEL = "GPT-6 Luna";

export const PRESET_PROMPTS: Record<AnalysisPreset, string> = {
  translate: `提供された画像に含まれている英文を検出し、丁寧かつ自然な日本語に翻訳してください（複数枚ある場合は画像順に整理してください）。

以下のフォーマットで出力してください：
### 📝 検出された原文
(英文をここに記述。複数画像の場合は [画像1], [画像2] などの見出しをつけて記述)

### 🇯🇵 日本語訳
(自然な日本語訳をここに記述)

### 💡 補足・ニュアンス
(文脈や特徴的な表現、画像間のつながり等の補足があれば簡潔に記述)`,

  grammar: `提供された画像に含まれている英文の文法および構文を詳しく分析・解説してください。

以下のフォーマットで出力してください：
### 📐 構文構造 (SVOC・骨格)
- 文の主語(S)、動詞(V)、修飾関係などの骨組みの分解

### 🔍 重要文法ポイント
- 関係代名詞/関係副詞、分詞構文、仮定法、接続詞、時制など注目すべき文法事項
- 読解でつまずきやすいポイントの解説

### 🎯 直訳と意味の取り方
- 構造に沿った直訳とスムーズに読むためのコツ`,

  vocab: `提供された画像に含まれている英文の中から、学習上重要な英単語やイディオム（熟語・連語）を抽出し、解説してください。

各単語について以下を記載してください：
- **見出し語** (品詞) : 日本語の意味
  - **画像内での用法/ニュアンス**: この文脈でどういう意味で使われているか
  - **類義語または注意点**`,

  summary: `提供された画像に含まれている英文の内容を素早く把握できるよう、要約してください。

### 📌 概要 (1〜2行)
### 📋 主なポイント (箇条書き)
### 🔑 結論またはキーメッセージ`,

  custom: "",
};

const OCR_RULES = `出力ルール:
- 段落の途中の改行（画像内での行の折り返し）は削除し、1つの段落は1行につなげる。1文ごとに改行しない
- 行末のハイフンで分割された単語は元の1語に戻す（例: "infor-" と "mation" → "information"）
- 段落と段落、見出しと本文の間は空行（改行2つ）で区切る
- 記事のタイトル・見出し・リード文・本文のみを出力する。次のものは出力しない:
  - ヘッダー、フッター、ページ番号、柱（ランニングヘッド）、著作権表示
  - 写真や図のキャプション、写真クレジット（例: "ALEX WONG/GETTY"）
  - 雑誌・新聞のコーナー名やセクション名（例: "NEWS, OPINION + ANALYSIS"）、著者名の表記（例: "BY ..."）
  - 広告、ナビゲーションやメニュー、ボタンなどの UI 要素、SNS の共有ボタン、Cookie の案内
- 挨拶・前置き・注釈・Markdown 記法は付けず、英文テキストのみを出力する`;

const API_KEY_MISSING =
  "OpenAI APIキーが設定されていません。右上の設定ボタンからAPIキーを入力してください。";

/** 語義検索の応答形式（Structured Outputs） */
const WORD_DEFINITION_SCHEMA = {
  type: "object",
  properties: {
    partOfSpeech: { type: "string", description: "品詞（例: 名詞, 動詞, 形容詞, 句動詞 等）" },
    meaning: { type: "string", description: "この文脈での日本語の意味（簡潔に1〜2語）" },
    detail: { type: "string", description: "文脈でのニュアンスや使われ方の簡単な解説（1行程度）" },
    phonetic: { type: "string", description: "発音目安（カタカナまたは発音記号）" },
  },
  required: ["partOfSpeech", "meaning", "detail", "phonetic"],
  additionalProperties: false,
} as const;

/** data URL の画像を Responses API の入力に変換する */
const toImageInputs = (dataUrls: string[]): ResponseInputContent[] =>
  dataUrls.map((url, idx) => {
    if (!/^data:image\/[^;]+;base64,/u.test(url)) {
      throw new Error(`画像 ${idx + 1} のデータ形式が無効です。`);
    }
    // 英文の読み取りが目的なので高解像度で送る
    return { type: "input_image", image_url: url, detail: "high" };
  });

/**
 * ストリーミングイベントからテキスト差分を取り出して連結する
 */
async function collectTextStream(
  stream: AsyncIterable<ResponseStreamEvent>,
  onChunk: (delta: string) => void,
): Promise<{ fullText: string; interactionId?: string }> {
  let fullText = "";
  let interactionId: string | undefined;

  for await (const event of stream) {
    switch (event.type) {
      case "response.created":
      case "response.completed":
        interactionId = event.response.id;
        break;
      case "response.output_text.delta":
        fullText += event.delta;
        onChunk(event.delta);
        break;
      case "error":
        throw new Error(event.message);
      case "response.failed":
        throw new Error(event.response.error?.message ?? "応答の生成に失敗しました");
      default:
        break;
    }
  }

  return { fullText, interactionId };
}

/** OpenAI の Responses API の応答 ID か（Gemini 時代に保存された会話 ID と区別する） */
export const isResponseId = (id: string | undefined): id is string => !!id?.startsWith("resp_");

export class AiService {
  private client: OpenAI | null = null;
  private currentApiKey: string = "";
  private wordCache = new Map<string, WordDefinition>();

  public init(apiKey: string) {
    if (this.currentApiKey === apiKey && this.client) {
      return;
    }
    this.currentApiKey = apiKey;
    // デスクトップ用のローカルアプリで、APIキーは利用者自身がブラウザに保存する前提
    this.client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  }

  private requireClient(): OpenAI {
    if (!this.client) {
      throw new Error(API_KEY_MISSING);
    }
    return this.client;
  }

  /**
   * 画像から英文テキストをOCR文字起こしする
   */
  public async extractTextFromImages(
    base64DataUrls: string[],
    modelName: string = DEFAULT_MODEL,
  ): Promise<string> {
    const client = this.requireClient();
    if (base64DataUrls.length === 0) {
      return "";
    }

    const prompt =
      base64DataUrls.length > 1
        ? `これらの画像に含まれている本文の英文を、画像順・段落順に正確に文字起こし（OCR）してください。

${OCR_RULES}
- 画像ごとに、その画像の本文の前に [画像1] のような見出しを1行で付ける`
        : `この画像に含まれている本文の英文を、段落順に正確に文字起こし（OCR）してください。

${OCR_RULES}`;

    const response = await client.responses.create({
      model: modelName,
      reasoning: { effort: "low" },
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }, ...toImageInputs(base64DataUrls)],
        },
      ],
    });

    return response.output_text.trim();
  }

  /**
   * 単語・熟語の語義を辞書検索する（文脈考慮、ローカルキャッシュ付き）
   */
  public async lookupWordDefinition(
    word: string,
    contextSentence: string = "",
    modelName: string = DEFAULT_MODEL,
  ): Promise<WordDefinition> {
    const cleanWord = word
      .trim()
      .toLowerCase()
      .replaceAll(/^[^a-zA-Z]+|[^a-zA-Z]+$/gu, "");
    const cacheKey = `${cleanWord}__${contextSentence.slice(0, 40)}`;

    const cached = this.wordCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const client = this.requireClient();

    try {
      const response = await client.responses.create({
        model: modelName,
        reasoning: { effort: "low" },
        instructions:
          "英単語または熟語（句動詞・連語など複数語の表現を含む）の日本語の語義を、与えられた文脈に合わせて答えてください。",
        input: `英単語・熟語: "${cleanWord}"\n文脈（前後の文）: "${contextSentence}"`,
        text: {
          format: {
            type: "json_schema",
            name: "word_definition",
            schema: WORD_DEFINITION_SCHEMA,
            strict: true,
          },
        },
      });

      const parsed = JSON.parse(response.output_text) as Omit<WordDefinition, "word">;
      const result: WordDefinition = {
        word: cleanWord,
        partOfSpeech: parsed.partOfSpeech || "品詞",
        meaning: parsed.meaning || "意味を取得できませんでした",
        detail: parsed.detail,
        phonetic: parsed.phonetic,
      };

      this.wordCache.set(cacheKey, result);
      return result;
    } catch (err) {
      console.warn("Failed to lookup word definition:", err);
      return {
        word: cleanWord,
        partOfSpeech: "語句",
        meaning: cleanWord,
        detail: "語義の取得に失敗しました",
      };
    }
  }

  /**
   * 1枚または複数枚の画像とプロンプトを送信してストリーミングで回答を取得する
   */
  public async analyzeImagesStream(
    base64DataUrls: string[],
    prompt: string,
    onChunk: (delta: string) => void,
    modelName: string = DEFAULT_MODEL,
  ): Promise<{ fullText: string; interactionId?: string }> {
    const client = this.requireClient();
    if (base64DataUrls.length === 0) {
      throw new Error("解析対象の画像がありません。");
    }

    try {
      const stream = await client.responses.create({
        model: modelName,
        stream: true,
        input: [
          {
            role: "user",
            content: [...toImageInputs(base64DataUrls), { type: "input_text", text: prompt }],
          },
        ],
      });
      return await collectTextStream(stream, onChunk);
    } catch (err) {
      console.error("OpenAI API error:", err);
      throw new Error(`OpenAI API 呼び出しエラー: ${errorMessage(err)}`, { cause: err });
    }
  }

  /**
   * 追加質問（前回の応答に続けて、テキストのみで会話を継続）
   */
  public async continueChatStream(
    prompt: string,
    previousResponseId: string,
    onChunk: (delta: string) => void,
    modelName: string = DEFAULT_MODEL,
  ): Promise<{ fullText: string; interactionId?: string }> {
    const client = this.requireClient();

    try {
      const stream = await client.responses.create({
        model: modelName,
        stream: true,
        previous_response_id: previousResponseId,
        input: prompt,
      });
      return await collectTextStream(stream, onChunk);
    } catch (err) {
      console.error("OpenAI API continue chat error:", err);
      throw new Error(`OpenAI API 呼び出しエラー: ${errorMessage(err)}`, { cause: err });
    }
  }
}

export const aiService = new AiService();
