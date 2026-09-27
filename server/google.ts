import { createHash, randomBytes } from "node:crypto";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** OIDC（アカウント表示用）+ アプリが作成したファイルのみ扱える Drive スコープ */
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.file"];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokenSet {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  email?: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export const base64url = (buf: Buffer) => buf.toString("base64url");

export const ensureOk = async (res: Response, context: string): Promise<Response> => {
  if (!res.ok) {
    throw new GoogleApiError(`${context}: ${res.status} ${await res.text()}`, res.status);
  }
  return res;
};

/**
 * ID トークンからメールアドレスを取り出す。
 * トークンエンドポイントから TLS で直接受け取った ID トークンなので、署名検証は省略できる
 * （OpenID Connect Core 1.0, 3.1.3.7）。表示用途にのみ使う
 */
const emailFromIdToken = (idToken: string): string | undefined => {
  const payload = idToken.split(".")[1];
  if (!payload) return undefined;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    email?: string;
  };
  return claims.email;
};

const toTokenSet = (json: TokenResponse): TokenSet => ({
  accessToken: json.access_token,
  expiresAt: Date.now() + json.expires_in * 1000,
  refreshToken: json.refresh_token,
  email: json.id_token ? emailFromIdToken(json.id_token) : undefined,
});

// ---- OAuth 2.0 / OIDC (authorization code flow + PKCE) ----

export const createAuthRequest = (config: GoogleOAuthConfig) => {
  const state = base64url(randomBytes(16));
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());

  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    // リフレッシュトークンを確実に受け取る
    access_type: "offline",
    prompt: "consent",
  }).toString();

  return { url: url.toString(), state, codeVerifier };
};

export const exchangeCode = async (
  config: GoogleOAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<TokenSet> => {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
    }),
  });
  await ensureOk(res, "token exchange");
  return toTokenSet((await res.json()) as TokenResponse);
};

export const refreshAccessToken = async (
  config: GoogleOAuthConfig,
  refreshToken: string,
): Promise<TokenSet> => {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  await ensureOk(res, "token refresh");
  return toTokenSet((await res.json()) as TokenResponse);
};

export const revokeToken = async (token: string): Promise<void> => {
  await fetch(REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
};
