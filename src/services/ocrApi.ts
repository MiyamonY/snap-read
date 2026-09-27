/** 保存済みの画像を Google Cloud Vision で文字認識する（サーバー経由） */
export const recognizeImages = async (imageIds: string[]): Promise<string> => {
  const res = await fetch("/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageIds }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return ((await res.json()) as { text: string }).text;
};
