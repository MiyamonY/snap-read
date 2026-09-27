/**
 * Maganize Desktop Launcher
 * Launches the Vite server and opens an app-mode desktop window.
 */

const HOST = "127.0.0.1";
const PORT = 5173;
const APP_URL = `http://${HOST}:${PORT}`;

async function isPortOpen(): Promise<boolean> {
  try {
    const conn = await Deno.connect({ hostname: HOST, port: PORT });
    conn.close();
    return true;
  } catch {
    return false;
  }
}

async function findBrowserCommand(): Promise<{ bin: string } | null> {
  const candidates = [
    "google-chrome-stable",
    "google-chrome",
    "chromium-browser",
    "chromium",
    "brave-browser",
    "microsoft-edge",
  ];

  for (const bin of candidates) {
    try {
      const check = new Deno.Command("which", { args: [bin] });
      const { code } = await check.output();
      if (code === 0) {
        return { bin };
      }
    } catch {
      // Continue searching
    }
  }

  return null;
}

async function main() {
  console.log("🚀 SnapRead Desktop Launcher を起動しています...");

  let viteProcess: Deno.ChildProcess | null = null;
  const alreadyRunning = await isPortOpen();

  if (!alreadyRunning) {
    console.log("📦 Vite 開発サーバーを開始しています...");
    const viteCmd = new Deno.Command("deno", {
      args: [
        "run",
        "-A",
        "--node-modules-dir=auto",
        "npm:vite",
        "--host",
        HOST,
        "--port",
        String(PORT),
      ],
      stdout: "inherit",
      stderr: "inherit",
    });
    viteProcess = viteCmd.spawn();

    // Wait until port is open
    console.log("⏳ サーバーの起動を待機中...");
    let attempts = 0;
    while (!(await isPortOpen()) && attempts < 40) {
      await new Promise((r) => {
        setTimeout(r, 250);
      });
      attempts++;
    }

    if (attempts >= 40) {
      console.error("❌ サーバーの起動がタイムアウトしました。");
      if (viteProcess) viteProcess.kill();
      Deno.exit(1);
    }
  }

  console.log(`✨ サーバーが稼働中: ${APP_URL}`);

  // Find Chrome / Chromium browser
  const browser = await findBrowserCommand();

  // Create clean user profile dir for standalone app
  const appDataDir = `/tmp/snapread-desktop-profile`;

  if (browser) {
    console.log(`🖥️ デスクトップアプリウィンドウを起動しています (${browser.bin})...`);
    const appWindow = new Deno.Command(browser.bin, {
      args: [
        `--app=${APP_URL}`,
        `--user-data-dir=${appDataDir}`,
        "--window-size=1280,820",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
      ],
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();

    // Wait for the desktop app window to close
    await appWindow.status;
  } else {
    console.log(`⚠️ Chromium系ブラウザが見つかりませんでした。通常のブラウザで開きます...`);
    const opener = Deno.build.os === "darwin" ? "open" : "xdg-open";
    new Deno.Command(opener, { args: [APP_URL] }).spawn();
  }

  if (viteProcess) {
    console.log("🛑 サーバーを停止しています...");
    viteProcess.kill();
  }
}

if (import.meta.main) {
  await main();
}
