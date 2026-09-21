import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { registerIpc } from "./ipc/index.js";
import { configureWorkspaceRoot, ensureWorkspaceSeed } from "./agent/config.js";
import { closeRuntime } from "./agent/runtime.js";
import { cancelRunForWindow, replayPendingApproval } from "./ipc/chat.js";
import { logError, logInfo } from "./app/logger.js";
import { refreshAppMenu } from "./menu.js";

// The main process has no console scrollback once packaged: failures that
// would have hit stderr go to ~/.deepagents/hermes/logs/hermes.log instead.
process.on("uncaughtException", (err) => logError("main.uncaughtException", err));
process.on("unhandledRejection", (reason) => logError("main.unhandledRejection", reason));

// Packaged builds keep the workspace under userData: everything inside the app
// bundle (app.asar) is read-only, so seeding it there fails on every launch.
if (app.isPackaged) {
  const workspace = join(app.getPath("userData"), "workspace");
  configureWorkspaceRoot(workspace);
  try {
    ensureWorkspaceSeed(workspace);
  } catch (err) {
    // Logged rather than fatal: the agent's own build failure names the same
    // path, and a read-only userData must not stop the app from opening.
    logError("app.workspaceSeed", err);
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      // electron-vite emits the preload bundle as ESM (.mjs) because the
      // package.json sets "type": "module".
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.on("ready-to-show", () => win.show());
  const contents = win.webContents;
  // A reload throws away the renderer's copy of an open approval card while
  // main still holds the gate: re-ask, or the run stays wedged forever.
  contents.on("did-finish-load", () => replayPendingApproval(contents));
  // The window that owns a run is also the only one that can answer its gate.
  win.on("closed", () => cancelRunForWindow(contents));
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// A second launch must surface the running window: two instances would fight
// over the same sqlite checkpoints, log file, and provider key store.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) {
      createWindow();
      return;
    }
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    refreshAppMenu();
    registerIpc();
    createWindow();
    logInfo("main", "hermes ready", { version: app.getVersion() });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

// better-sqlite3 keeps the checkpoint file open; closing it here leaves a clean
// database instead of a stale WAL for the next launch to recover.
app.on("before-quit", () => closeRuntime());
