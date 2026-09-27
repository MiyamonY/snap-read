import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { Store } from "./server/db.ts";
import { DriveSync } from "./server/driveSync.ts";
import { createFolderApi, createGoogleAuthApi, createImageApi } from "./server/api.ts";

const shutdownPlugin = (): Plugin => ({
  name: "shutdown-endpoint",
  configureServer(server) {
    server.middlewares.use("/api/shutdown", (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 100);
    });
  },
});

/**
 * フォルダ・チャット履歴・画像のパスを SQLite に、画像をローカルキャッシュ + Google ドライブに保存する API
 */
const storagePlugin = (env: Record<string, string>): Plugin => {
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

  const mount = (middlewares: Connect.Server) => {
    const { store, drive } = getServices();
    middlewares.use("/api/folders", createFolderApi(store, drive));
    middlewares.use("/api/images", createImageApi(drive));
    middlewares.use("/api/auth/google", createGoogleAuthApi(drive));
  };

  return {
    name: "snapread-storage",
    configureServer(server) {
      mount(server.middlewares);
      server.httpServer?.on("close", close);
    },
    configurePreviewServer(server) {
      mount(server.middlewares);
      server.httpServer.on("close", close);
    },
  };
};

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // VITE_ 以外の変数（GOOGLE_CLIENT_SECRET など）はサーバー側でのみ使い、クライアントには渡さない
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [tailwindcss(), react({ compiler: true }), shutdownPlugin(), storagePlugin(env)],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
    },
  };
});
