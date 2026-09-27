import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    shutdownPlugin(),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
