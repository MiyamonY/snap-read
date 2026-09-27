/** 複数画像の OCR 結果で、画像ごとの区切りとして出力される見出し（例: [画像1]） */
const IMAGE_MARKER = /^\[画像\d+\]$/u;

/** 段落内で折り返された行を1行につなげる */
const joinWrappedLines = (lines: string[]): string => {
  let joined = "";
  for (const line of lines) {
    if (!joined) {
      joined = line;
    } else if (/[a-z]-$/iu.test(joined)) {
      // 行末ハイフン（"well-" + "known"）は空白を入れずにつなげる
      joined += line;
    } else {
      joined += ` ${line}`;
    }
  }
  return joined;
};

/**
 * OCR 結果の改行を整える。
 * 空行を段落の区切りとし、段落内の改行（画像内での折り返しや1文ごとの改行）は空白でつなげる。
 * 段落は "\n\n" で区切って返す（何度適用しても結果は同じ）
 */
export const normalizeOcrText = (text: string): string => {
  const paragraphs: string[] = [];
  for (const block of text.replaceAll("\r\n", "\n").split(/\n\s*\n/u)) {
    let lines: string[] = [];
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (IMAGE_MARKER.test(trimmed)) {
        if (lines.length > 0) paragraphs.push(joinWrappedLines(lines));
        paragraphs.push(trimmed);
        lines = [];
      } else {
        lines.push(trimmed);
      }
    }
    if (lines.length > 0) paragraphs.push(joinWrappedLines(lines));
  }
  return paragraphs.join("\n\n");
};
