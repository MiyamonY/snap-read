import React, { useState } from "react";
import { Key, Eye, EyeOff, ExternalLink, Check, X } from "lucide-react";
import { DEFAULT_MODEL } from "../services/gemini.ts";

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  onSaveApiKey: (key: string) => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  onClose,
  apiKey,
  onSaveApiKey,
}) => {
  const [inputKey, setInputKey] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveApiKey(inputKey.trim());
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Key className="w-5 h-5 text-indigo-400" />
            <span>Gemini API 設定</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
          <p>
            Google Gemini API キーを入力してください。設定したキーはブラウザ/ローカルにのみ保存され、外部サーバーには送信されません。
          </p>

          <form onSubmit={handleSave} className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-slate-400 font-medium">Gemini API Key</span>
              <div className="relative flex items-center">
                <input
                  type={showKey ? "text" : "password"}
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 pr-10 text-white placeholder-slate-500 font-mono text-xs focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 text-slate-400 hover:text-slate-200 p-1"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </label>

            <div className="text-[11px] text-slate-400 space-y-1 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
              <div className="flex justify-between items-center">
                <span>使用モデル:</span>
                <span className="font-mono text-indigo-400 font-semibold">{DEFAULT_MODEL}</span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-slate-800/60">
                <span>APIキーをお持ちでない場合:</span>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 font-medium"
                >
                  Google AI Studioで取得
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                キャンセル
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all"
              >
                {saved ? <Check className="w-4 h-4 text-emerald-300" /> : null}
                <span>{saved ? "保存しました" : "設定を保存"}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
