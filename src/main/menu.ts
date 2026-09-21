import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from "electron";

import { lock } from "./app/auth.js";
import { logError, logInfo } from "./app/logger.js";
import { clearSecretsKey } from "./app/secrets.js";
import { readSettings } from "./app/settings.js";
import { workspaceDirPath } from "./agent/config.js";
import { logsDir } from "./agent/paths.js";
import type { AppCommand } from "../shared/wire.js";

const mod = process.platform === "darwin" ? "Cmd" : "Ctrl";

/** Pages the menu can open; the renderer decides what each one shows. */
const NAV_ITEMS: Array<{ label: string; command: AppCommand; key: string }> = [
  { label: "Chat", command: "chat", key: "1" },
  { label: "Threads", command: "threads", key: "2" },
  { label: "Skills", command: "skills", key: "3" },
  { label: "Memory", command: "memory", key: "4" },
  { label: "Files", command: "files", key: "5" },
];

/**
 * The renderer gate follows these instead of guessing, so every path that can
 * lock the app announces it.
 */
export function broadcastLocked(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("app:event", { type: "locked" });
  }
}

/** Menu-driven navigation is a notice, not a command the menu could execute itself. */
function sendCommand(command: AppCommand): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("app:event", { type: "command", command });
  }
}

/**
 * Lock from the application menu: main owns the lock state, so the item flips
 * it and pushes "locked" to every window. Without a PIN the lock screen has
 * nothing to accept, so the item stays disabled and this refuses.
 */
export function lockNow(): void {
  if (!readSettings().pinConfigured) return;
  clearSecretsKey(); // the PIN-derived key is per session: never outlive the lock
  lock();
  logInfo("app", "locked from the application menu");
  broadcastLocked();
}

function lockMenuItem(): MenuItemConstructorOptions {
  return {
    label: "Lock Now",
    accelerator: `${mod}+L`,
    enabled: readSettings().pinConfigured,
    click: lockNow,
  };
}

function sessionMenu(): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = [
    {
      label: "New Thread",
      accelerator: `${mod}+N`,
      click: () => sendCommand("new-thread"),
    },
  ];
  // macOS keeps Lock Now and Quit in the application menu.
  if (process.platform !== "darwin") {
    submenu.push({ type: "separator" }, lockMenuItem(), { type: "separator" }, { role: "quit" });
  }
  return { label: "Session", submenu };
}

function editMenu(): MenuItemConstructorOptions {
  return {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  };
}

function goMenu(): MenuItemConstructorOptions {
  return {
    label: "Go",
    submenu: [
      ...NAV_ITEMS.map(({ label, command, key }) => ({
        label,
        accelerator: `${mod}+${key}`,
        click: () => sendCommand(command),
      })),
      { type: "separator" },
      { label: "Settings", accelerator: `${mod}+,`, click: () => sendCommand("settings") },
    ],
  };
}

function viewMenu(): MenuItemConstructorOptions {
  return {
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      // Kept in the menu because the renderer may be the thing that is broken.
      { label: "Reveal log", click: () => shell.showItemInFolder(logsDir()) },
      {
        label: "Open workspace",
        click: () => {
          void shell.openPath(workspaceDirPath()).then((failure) => {
            if (failure) logError("menu.openWorkspace", new Error(failure));
          });
        },
      },
    ],
  };
}

function template(): MenuItemConstructorOptions[] {
  if (process.platform !== "darwin") {
    return [sessionMenu(), editMenu(), goMenu(), viewMenu()];
  }
  return [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        lockMenuItem(),
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    sessionMenu(),
    editMenu(),
    goMenu(),
    viewMenu(),
    { role: "windowMenu" },
  ];
}

/** Rebuild the menu so the PIN-dependent items track the stored settings. */
export function refreshAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template()));
}
