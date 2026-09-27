import { GoogleGenAI } from "@google/genai";
import { AnalysisPreset, WordDefinition } from "../types.ts";

export const DEFAULT_MODEL = "gemini-3.8-flash";

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

export class GeminiService {
  private client: GoogleGenAI | null = null;
  private currentApiKey: string = "";
  private wordCache = new Map<string, WordDefinition>();

  constructor(apiKey?: string) {
    if (apiKey) {
      this.init(apiKey);
    }
  }

  public init(apiKey: string) {
    if (this.currentApiKey === apiKey && this.client) {
      return;
    }
    this.currentApiKey = apiKey;
    this.client = new GoogleGenAI({ apiKey });
  }

  public isReady(): boolean {
    return !!this.client && !!this.currentApiKey;
  }

  /**
   * 画像から英文テキストをOCR文字起こしする
   */
  public async extractTextFromImages(
    base64DataUrls: string[],
    modelName: string = DEFAULT_MODEL,
  ): Promise<string> {
    if (!this.client) {
      throw new Error(
        "Gemini APIキーが設定されていません。右上の設定ボタンからAPIキーを入力してください。",
      );
    }

    if (base64DataUrls.length === 0) {
      return "";
    }

    const imageParts = base64DataUrls.map((url, idx) => {
      const matches = url.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        throw new Error(`画像 ${idx + 1} のデータ形式が無効です。`);
      }
      return {
        type: "image" as const,
        data: matches[2],
        mime_type: matches[1],
      };
    });

    const prompt =
      base64DataUrls.length > 1
        ? "これらの画像に含まれているすべての英文を、画像順・段落順に正確に文字起こし（OCR）してください。挨拶や注釈は含めず、純粋な英文テキストのみ（必要に応じて[画像1]などの見出し）を出力してください。"
        : "この画像に含まれているすべての英文を、元の段落や改行を保ちながら正確に文字起こし（OCR）してください。挨拶や注釈は含めず、純粋な英文テキストのみを出力してください。";

    const interaction = (await this.client.interactions.create({
      model: modelName,
      input: [...imageParts, { type: "text", text: prompt }] as any,
    })) as unknown as { output_text?: string };

    return interaction.output_text?.trim() || "";
  }

  /**
   * 単語の語義を辞書検索する（文脈考慮、ローカルキャッシュ付き）
   */
  public async lookupWordDefinition(
    word: string,
    contextSentence: string = "",
    modelName: string = DEFAULT_MODEL,
  ): Promise<WordDefinition> {
    const cleanWord = word
      .trim()
      .toLowerCase()
      .replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, "");
    const cacheKey = `${cleanWord}__${contextSentence.slice(0, 40)}`;

    if (this.wordCache.has(cacheKey)) {
      return this.wordCache.get(cacheKey)!;
    }

    if (!this.client) {
      throw new Error("Gemini APIキーが設定されていません。");
    }

    const prompt = `次の英単語の日本語の語義を、文脈に合わせて教えてください。
必ず以下のJSONフォーマットのみを返してください（Markdownコードブロックも不要、純粋なJSON文字列のみ）：

{
  "word": "${cleanWord}",
  "partOfSpeech": "品詞（例: 名詞, 動詞, 形容詞 等）",
  "meaning": "この文脈での日本語の意味（簡潔に1〜2語）",
  "detail": "文脈でのニュアンスや使われ方の簡単な解説（1行程度）",
  "phonetic": "発音目安（カタカナまたは発音記号）"
}

英単語: "${cleanWord}"
文脈（前後の文）: "${contextSentence}"`;

    try {
      const interaction = (await this.client.interactions.create({
        model: modelName,
        input: prompt,
      })) as unknown as { output_text?: string };

      const rawText = interaction.output_text?.trim() || "{}";
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : rawText;
      const parsed = JSON.parse(jsonStr);

      const result: WordDefinition = {
        word: cleanWord,
        partOfSpeech: parsed.partOfSpeech || "品詞",
        meaning: parsed.meaning || "意味を取得できませんでした",
        detail: parsed.detail || "",
        phonetic: parsed.phonetic || "",
      };

      this.wordCache.set(cacheKey, result);
      return result;
    } catch (err: any) {
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
   * 1枚または複数枚の画像とプロンプトをGeminiに送信してストリーミングで回答を取得する
   */
  public async analyzeImagesStream(
    base64DataUrls: string[],
    prompt: string,
    onChunk: (delta: string) => void,
    modelName: string = DEFAULT_MODEL,
    previousInteractionId?: string,
  ): Promise<{ fullText: string; interactionId?: string }> {
    if (!this.client) {
      throw new Error(
        "Gemini APIキーが設定されていません。右上の設定ボタンからAPIキーを入力してください。",
      );
    }

    if (base64DataUrls.length === 0) {
      throw new Error("解析対象の画像がありません。");
    }

    const imageParts = base64DataUrls.map((url, idx) => {
      const matches = url.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        throw new Error(`画像 ${idx + 1} のデータ形式が無効です。`);
      }
      return {
        type: "image",
        data: matches[2],
        mime_type: matches[1],
      };
    });

    const inputParts: any[] = [
      ...imageParts,
      {
        type: "text",
        text: prompt,
      },
    ];

    try {
      const requestOptions: any = {
        model: modelName,
        input: inputParts,
        stream: true,
      };

      if (previousInteractionId) {
        requestOptions.previous_interaction_id = previousInteractionId;
      }

      const stream = (await this.client.interactions.create(
        requestOptions,
      )) as unknown as AsyncIterable<any>;

      let fullText = "";
      let interactionId: string | undefined = undefined;

      for await (const event of stream) {
        if (event && "interaction" in event && event.interaction?.id) {
          interactionId = event.interaction.id;
        }

        if (event.event_type === "step.delta" && event.delta) {
          if (event.delta.type === "text" && event.delta.text) {
            fullText += event.delta.text;
            onChunk(event.delta.text);
          }
        }
      }

      return { fullText, interactionId };
    } catch (err: any) {
      console.error("Gemini API error:", err);
      throw new Error(`Gemini API 呼び出しエラー: ${err.message || String(err)}`, { cause: err });
    }
  }

  /**
   * 単一画像向けラッパー
   */
  public async analyzeImageStream(
    base64DataUrl: string,
    prompt: string,
    onChunk: (delta: string) => void,
    modelName: string = DEFAULT_MODEL,
    previousInteractionId?: string,
  ): Promise<{ fullText: string; interactionId?: string }> {
    return this.analyzeImagesStream(
      [base64DataUrl],
      prompt,
      onChunk,
      modelName,
      previousInteractionId,
    );
  }

  /**
   * 追加質問（テキストのみでの会話継続）
   */
  public async continueChatStream(
    prompt: string,
    previousInteractionId: string,
    onChunk: (delta: string) => void,
    modelName: string = DEFAULT_MODEL,
  ): Promise<{ fullText: string; interactionId?: string }> {
    if (!this.client) {
      throw new Error("Gemini APIキーが設定されていません。");
    }

    try {
      const stream = (await this.client.interactions.create({
        model: modelName,
        input: prompt,
        previous_interaction_id: previousInteractionId,
        stream: true,
      })) as unknown as AsyncIterable<any>;

      let fullText = "";
      let interactionId: string | undefined = undefined;

      for await (const event of stream) {
        if (event && "interaction" in event && event.interaction?.id) {
          interactionId = event.interaction.id;
        }

        if (event.event_type === "step.delta" && event.delta) {
          if (event.delta.type === "text" && event.delta.text) {
            fullText += event.delta.text;
            onChunk(event.delta.text);
          }
        }
      }

      return { fullText, interactionId };
    } catch (err: any) {
      console.error("Gemini API continue chat error:", err);
      throw new Error(`Gemini API 呼び出しエラー: ${err.message || String(err)}`, { cause: err });
    }
  }
}

export const geminiService = new GeminiService();
