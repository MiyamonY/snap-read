# SnapRead (スナップリード) 📸📖

> Deno + Vite + React + TypeScript で構築された、リアルタイム英文キャプチャ＆AI解析デスクトップアプリケーション。

Webカメラや画面キャプチャ（PDF・英語記事・ゲーム・動画・プレゼン等）の映像を取り込み、OpenAI の **GPT-6 Luna**（`gpt-6-luna`）を用いて、画像内の英文をリアルタイムに翻訳・構文解析・語彙解説・質問応答します。

---

## 🌟 主な機能

- 🖥️ **画面キャプチャ (`getDisplayMedia`)**: デスクトップ全体、特定ウィンドウ、ブラウザタブからリアルタイム取得
- 📷 **Webカメラ映像 (`getUserMedia`)**: 接続されたカメラから紙の洋書・雑誌・書類を直接取り込み
- 📚 **複数枚の連続取り込み**: 複数ページや見開き、連続したスライド・記事を何枚でも連続キャプチャ・一括解析
- 🖼️ **画像ファイル読込**: 手持ちの画像ファイルも複数まとめてドラッグ＆ドロップまたはファイル選択可能
- ✂️ **ドラッグ＆ドロップ 範囲選択 (クロップ)**: 各画像上で読みたい英文をマウスドラッグで直感的に切り出し
- 📖 **OCR文字起こし & 単語クリック辞書 (スマート語義ポップアップ)**:
  - 画像内の英文を高精度にテキスト化
  - 気になる英単語をクリックするだけで、文脈に合った日本語の語義（品詞・意味・ニュアンス・発音目安）がその場でポップアップ表示
  - 「この単語について詳しく質問」ボタンでAIチャットにシームレスに深掘り質問
- 🗂️ **フォルダ管理**: 画像・OCR結果・チャット履歴をフォルダ単位で複数保持（タブで切り替え、ダブルクリックで名前変更）
- ☁️ **保存 (SQLite + Google ドライブ)**: フォルダやチャット履歴、画像のパスは SQLite に、画像は Google ドライブの `SnapRead/<フォルダ名>/` に保存
- 📐 **集中読解レイアウト**: 結果とチャット入力欄を左側に広く大きく配置し、右側で取り込みソースや画像トレイを直感操作
- 🤖 **GPT-6 Luna によるAI解析**:
  - 📝 **全文翻訳**: 全ページの自然な日本語訳と原文の対応
  - 🔍 **構文・文法解説**: SVOC構造分解、関係詞・分詞構文・仮定法などのポイント解説
  - 📚 **重要単語・熟語**: 英文内の重要語彙と文脈に応じたニュアンス
  - 💡 **要約・要点**: 長文や複数ページの大意をすばやく箇条書き
  - 💬 **自由質問 (対話Q&A)**: 「この部分の主語はどれ？」「ビジネスでの言い換えは？」などをチャット形式で追加質問
  - ⚡ **リアルタイムストリーミング**: 回答を文字単位でスムーズに表示

---

## 🛠️ 技術スタック

- **ランタイム / パッケージ管理**: [Deno 2.9+](https://deno.com/) + [mise](https://mise.jdx.dev/)
- **フロントエンド**: [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite 8](https://vite.dev/) (Rolldown)
- **スタイリング**: [Tailwind CSS v4](https://tailwindcss.com/)
- **アイコン**: [lucide-react](https://lucide.dev/)
- **AI SDK**: [openai](https://www.npmjs.com/package/openai)（Responses API、`gpt-6-luna`）
- **OCR**: [Google Cloud Vision API](https://cloud.google.com/vision)（`DOCUMENT_TEXT_DETECTION`）
- **React Compiler**: [oxc-transform-react](https://npmx.dev/package/oxc-transform-react)（Rust 版・実験的）
- **保存**: SQLite (`node:sqlite`) + Google Drive API（OAuth 2.0 / OIDC）

---

## 🚀 使い方

### 1. 環境構築 (mise)

プロジェクトディレクトリで mise を実行して Deno をセットアップします：

```bash
mise install
```

### 2. OpenAI API キーの設定

[OpenAI Platform](https://platform.openai.com/api-keys) で取得した API キーを設定します。

以下のいずれかの方法で設定可能です：

- **方法 A: アプリ画面から入力（おすすめ）**
  - アプリ起動後、右上の「APIキー設定」ボタンから入力して保存（ローカルに安全に保存されます）
- **方法 B: `.env` ファイルに記述**
  ```bash
  cp .env.example .env
  # .env を編集して VITE_OPENAI_API_KEY=your_key を設定
  ```

### 3. Google 連携（ドライブ保存・OCR）の設定

画像の保存に Google ドライブ、文字認識（OCR）に Google Cloud Vision API を使います。どちらもアプリから Google アカウントに接続（OAuth 2.0 / OIDC）して利用します。読み取った文字は GPT-6 Luna で本文だけに整形します（フッター・キャプション等の除去、段落の結合）。

未接続の間、画像はローカル（`data/image-cache/`）にのみ保存され、OCR は使えません。接続すると、それまでの画像もまとめてドライブにアップロードされます。

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成し、**Google Drive API** と **Cloud Vision API** を有効化（Cloud Vision は課金の有効化が必要）
2. **OAuth 同意画面**を設定（テストユーザーに自分のアカウントを追加）し、「データアクセス」で `https://www.googleapis.com/auth/cloud-vision` スコープを追加
3. **認証情報 → OAuth クライアント ID**（種類: ウェブアプリケーション）を作成し、承認済みのリダイレクト URI に次を追加
   ```
   http://127.0.0.1:5173/api/auth/google/callback
   ```
4. `.env` にクライアント ID とシークレットを設定
   ```bash
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxxxxxx
   ```
5. アプリ右上の「Google に接続」から Google アカウントで認可（`cloud-vision` スコープを追加する前に接続していた場合は、一度接続を解除して再接続）

スコープは `openid email`（接続中のアカウント表示用）、`drive.file`（このアプリが作成したファイルのみ）、`cloud-vision`（OCR）です。Cloud Vision の利用料金は、OAuth クライアントを作成したプロジェクトに計上されます。

| 環境変数                                    | 既定値                                           | 説明                     |
| ------------------------------------------- | ------------------------------------------------ | ------------------------ |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | なし                                             | OAuth クライアント       |
| `GOOGLE_REDIRECT_URI`                       | `http://127.0.0.1:5173/api/auth/google/callback` | リダイレクト URI         |
| `SNAPREAD_DB_PATH`                          | `data/snapread.db`                               | SQLite データベース      |
| `SNAPREAD_CACHE_DIR`                        | `data/image-cache`                               | 画像のローカルキャッシュ |

### 4. アプリケーションの起動

#### デスクトップアプリモードで起動 (独立ウィンドウ)

```bash
mise run desktop
# または deno task desktop
```

_Chromium/Chrome のスタンドアロンウィンドウ（アドレスバーなし）としてアプリが起動します。_

#### ブラウザ開発サーバーとして起動

```bash
mise run dev
# または deno task dev
```

ブラウザで `http://127.0.0.1:5173` を開きます。

#### プロダクションビルド

```bash
mise run build
# または deno task build
```

#### Lint / フォーマット

```bash
mise run lint        # または deno task lint（oxlint）
mise run fmt         # または deno task fmt（oxfmt で整形）
deno task lint:fix   # 自動修正可能な lint 指摘を修正
deno task fmt:check  # フォーマット差分のチェックのみ
```

#### Git フック (lint-staged)

コミット時に、ステージしたファイルへ `oxlint --fix` と `oxfmt` を自動で実行します。`mise install` で自動的に有効化されます。手動で有効化する場合は次を実行してください：

```bash
deno task hooks:install
```
