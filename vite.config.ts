import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { Store } from "./server/db.ts";
import { DriveSync } from "./server/driveSync.ts";
import { createApiApp } from "./server/api.ts";
import { oakMiddleware } from "./server/connect.ts";

/**
 * /api 以下を Oak で処理する。
 * フォルダ・チャット履歴・画像のパスを SQLite に、画像をローカルキャッシュ + Google ドライブに保存する
 */
const apiPlugin = (env: Record<string, string>): Plugin => {
  let services: { store: Store; drive: DriveSync } | undefined;
  const getServices = () => {
    if (!services) {
      const store = new Store(env.SNAPREAD_DB_PATH || "data/snapread.db");
      const oauth =
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
          ? {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              redirectUri:
                env.GOOGLE_REDIRECT_URI || "http://127.0.0.1:5173/api/auth/google/callback",
            }
          : undefined;
      const drive = new DriveSync(store, env.SNAPREAD_CACHE_DIR || "data/image-cache", oauth);
      drive.start();
      services = { store, drive };
    }
    return services;
  };
  const close = () => {
    services?.drive.stop();
    services?.store.close();
    services = undefined;
  };

  const mount = (middlewares: Connect.Server, closeServer: () => Promise<void>) => {
    const app = createApiApp({
      ...getServices(),
      onShutdown: async () => {
        await closeServer();
        process.exit(0);
      },
    });
    middlewares.use(oakMiddleware(app, "/api/"));
  };

  return {
    name: "snapread-api",
    configureServer(server) {
      mount(server.middlewares, () => server.close());
      server.httpServer?.on("close", close);
    },
    configurePreviewServer(server) {
      mount(server.middlewares, () => server.close());
      server.httpServer.on("close", close);
    },
  };
};

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // VITE_ 以外の変数（GOOGLE_CLIENT_SECRET など）はサーバー側でのみ使い、クライアントには渡さない
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [tailwindcss(), react({ compiler: true }), apiPlugin(env)],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
    },
  };
});
