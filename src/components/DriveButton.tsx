import React, { useEffect, useState } from "react";
import { Cloud, CloudOff, Loader2 } from "lucide-react";
import { DRIVE_LOGIN_URL, driveApi } from "../services/driveApi.ts";
import type { DriveStatus } from "../services/driveApi.ts";

const POLL_INTERVAL_MS = 10_000;

/** Google アカウント（ドライブ保存・OCR）の接続状態の表示と、接続・接続解除 */
export const DriveButton: React.FC = () => {
  const [status, setStatus] = useState<DriveStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await driveApi.status();
        if (!cancelled) setStatus(next);
      } catch (err) {
        console.error("Failed to get drive status:", err);
      }
    };
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!status) return null;

  if (!status.configured) {
    return (
      <span
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border border-slate-700 text-slate-500"
        title=".env に GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を設定すると Google ドライブ保存と OCR が使えます"
      >
        <CloudOff className="w-3.5 h-3.5" />
        <span>ローカル保存</span>
      </span>
    );
  }

  if (!status.connected) {
    return (
      <a
        href={DRIVE_LOGIN_URL}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 transition-colors"
        title="画像の Google ドライブ保存と、Cloud Vision による OCR に使います"
      >
        <CloudOff className="w-3.5 h-3.5" />
        <span>Google に接続</span>
      </a>
    );
  }

  const handleDisconnect = async () => {
    if (!globalThis.confirm(`${status.email ?? "Google アカウント"} との接続を解除しますか？`)) {
      return;
    }
    try {
      await driveApi.logout();
      setStatus(await driveApi.status());
    } catch (err) {
      console.error("Failed to disconnect drive:", err);
    }
  };

  const title = [
    `${status.email ?? "Google ドライブ"} に接続中（クリックで接続解除）`,
    status.pendingUploads > 0 ? `未アップロード: ${status.pendingUploads} 枚` : "",
    status.lastError ? `同期エラー: ${status.lastError}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <button
      type="button"
      onClick={handleDisconnect}
      title={title}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
        status.lastError
          ? "border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
      }`}
    >
      {status.pendingUploads > 0 ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Cloud className="w-3.5 h-3.5" />
      )}
      <span className="max-w-40 truncate">{status.email ?? "ドライブ接続中"}</span>
    </button>
  );
};
