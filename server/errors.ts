/** 未接続・権限不足など、利用者の操作（接続・再接続）で解決できる認証エラー */
export class AuthError extends Error {
  override name = "AuthError";
}
