/** 本文と画像上のテキストで共通の、単語・熟語の照合処理 */

/** 英単語（前後の記号付き）: 例 "“word,” */
export const WORD_TOKEN = /^([^a-zA-Z]*)([a-zA-Z]+(?:['’-][a-zA-Z]+)*)([^a-zA-Z]*)$/u;

export const tokenize = (paragraph: string) => paragraph.split(/(\s+)/u);

export const cleanPhrase = (text: string) =>
  text.replaceAll(/^[^a-zA-Z]+|[^a-zA-Z]+$/gu, "").replaceAll(/\s+/gu, " ");

/** 段落内で、単語帳に登録済みの熟語（2語以上）に含まれるトークンの位置 */
export const findSavedPhraseTokens = (tokens: string[], phrases: string[][]): Set<number> => {
  const words = tokens.flatMap((token, index) => {
    const match = token.match(WORD_TOKEN);
    return match ? [{ index, word: match[2].toLowerCase() }] : [];
  });
  const hits = new Set<number>();
  for (const phrase of phrases) {
    for (let start = 0; start + phrase.length <= words.length; start++) {
      if (phrase.every((w, k) => words[start + k].word === w)) {
        for (let k = 0; k < phrase.length; k++) hits.add(words[start + k].index);
      }
    }
  }
  return hits;
};

/** 単語帳に登録済みの熟語（2語以上）を単語の並びに分解する */
export const savedPhraseList = (savedWords: Set<string>): string[][] =>
  [...savedWords].filter((w) => w.includes(" ")).map((w) => w.split(" "));
