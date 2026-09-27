import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { wordApi } from "../services/wordApi.ts";
import type { VocabularyEntry, VocabularyInput } from "../types.ts";
import { errorMessage } from "../utils.ts";

interface WordsState {
  folderId: string | undefined;
  words: VocabularyEntry[];
  isLoading: boolean;
  error: string | null;
}

type SetWordsState = Dispatch<SetStateAction<WordsState>>;

/** 指定フォルダの状態のときだけ更新する（別フォルダへ切り替わった後に届いた結果は捨てる） */
const onlyFor =
  (folderId: string, update: (prev: WordsState) => WordsState) => (prev: WordsState) =>
    prev.folderId === folderId ? update(prev) : prev;

const setError = (setState: SetWordsState, folderId: string, error: string) => {
  setState(onlyFor(folderId, (prev) => ({ ...prev, isLoading: false, error })));
};

const loadWords = async (setState: SetWordsState, folderId: string) => {
  try {
    const words = await wordApi.list(folderId);
    setState(onlyFor(folderId, (prev) => ({ ...prev, words, isLoading: false, error: null })));
  } catch (err) {
    setError(setState, folderId, `単語帳の読み込みに失敗しました: ${errorMessage(err)}`);
  }
};

/**
 * 指定フォルダの単語帳（SQLite の folder_words）を読み込み、登録・削除する。
 * folderId が未確定（フォルダ読み込み中）の間は何もしない
 */
export const useFolderWords = (folderId: string | undefined) => {
  const [state, setState] = useState<WordsState>({
    folderId,
    words: [],
    isLoading: folderId !== undefined,
    error: null,
  });

  // フォルダが切り替わったら表示中の単語帳をリセットする
  if (state.folderId !== folderId) {
    setState({ folderId, words: [], isLoading: folderId !== undefined, error: null });
  }

  useEffect(() => {
    if (folderId !== undefined) {
      loadWords(setState, folderId);
    }
  }, [folderId]);

  const addWord = async (word: string, input: VocabularyInput) => {
    if (folderId === undefined) return;
    try {
      await wordApi.save(folderId, word, input);
    } catch (err) {
      setError(setState, folderId, `単語の登録に失敗しました: ${errorMessage(err)}`);
      return;
    }
    // 他フォルダでの登録状況を含めて取り直す
    await loadWords(setState, folderId);
  };

  const removeWord = async (word: string) => {
    if (folderId === undefined) return;
    const key = word.toLowerCase();
    setState(
      onlyFor(folderId, (prev) => ({
        ...prev,
        words: prev.words.filter((w) => w.word.toLowerCase() !== key),
      })),
    );
    try {
      await wordApi.remove(folderId, word);
    } catch (err) {
      setError(setState, folderId, `単語の削除に失敗しました: ${errorMessage(err)}`);
      await loadWords(setState, folderId);
    }
  };

  const savedWords = new Set(state.words.map((w) => w.word.toLowerCase()));

  return {
    words: state.words,
    savedWords,
    isLoading: state.isLoading,
    error: state.error,
    addWord,
    removeWord,
  };
};
