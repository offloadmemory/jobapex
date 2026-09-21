import { contextBridge, ipcRenderer } from "electron";
import type { AppEvent, HermesApi, WireEvent } from "@shared/wire";

const api: HermesApi = {
  chat: {
    run: (req) => ipcRenderer.invoke("chat:run", req),
    cancel: (threadId) => ipcRenderer.invoke("chat:cancel", { threadId }),
    resolveApproval: (runId, decision) =>
      ipcRenderer.invoke("chat:resolveApproval", { runId, decision }),
  },
  threads: {
    list: () => ipcRenderer.invoke("threads:list"),
    history: (threadId) => ipcRenderer.invoke("threads:history", { threadId }),
    rename: (threadId, title) => ipcRenderer.invoke("threads:rename", { threadId, title }),
    remove: (threadId) => ipcRenderer.invoke("threads:delete", { threadId }),
  },
  skills: {
    list: () => ipcRenderer.invoke("skills:list"),
    read: (name) => ipcRenderer.invoke("skills:read", { name }),
    write: (s) => ipcRenderer.invoke("skills:write", s),
    remove: (name, source) => ipcRenderer.invoke("skills:delete", { name, source }),
  },
  memory: {
    list: () => ipcRenderer.invoke("memory:list"),
    search: (query) => ipcRenderer.invoke("memory:search", { query }),
    read: (slug) => ipcRenderer.invoke("memory:read", { slug }),
    write: (n) => ipcRenderer.invoke("memory:write", n),
    delete: (slug) => ipcRenderer.invoke("memory:delete", { slug }),
  },
  providers: {
    list: () => ipcRenderer.invoke("providers:list"),
    save: (p) => ipcRenderer.invoke("providers:save", p),
    discover: (p) => ipcRenderer.invoke("providers:discover", p),
    validate: (p) => ipcRenderer.invoke("providers:validate", p),
    setDefault: (id) => ipcRenderer.invoke("providers:setDefault", { id }),
    remove: (id) => ipcRenderer.invoke("providers:delete", { id }),
    clearKey: (id) => ipcRenderer.invoke("providers:clearKey", { id }),
  },
  files: {
    list: (dir) => ipcRenderer.invoke("files:list", { dir }),
    read: (path) => ipcRenderer.invoke("files:read", { path }),
    write: (path, content) => ipcRenderer.invoke("files:write", { path, content }),
    stage: (name, data) => ipcRenderer.invoke("files:stage", { name, data }),
    reveal: (path) => ipcRenderer.invoke("files:reveal", { path }),
  },
  app: {
    getInfo: () => ipcRenderer.invoke("app:getInfo"),
    getSettings: () => ipcRenderer.invoke("app:getSettings"),
    saveSettings: (s) => ipcRenderer.invoke("app:saveSettings", s),
    isLocked: () => ipcRenderer.invoke("app:isLocked"),
    lock: () => ipcRenderer.invoke("app:lock"),
    unlock: (pin) => ipcRenderer.invoke("app:unlock", { pin }),
    setup: (w) => ipcRenderer.invoke("app:setup", w),
    log: (level, message) => ipcRenderer.invoke("app:log", { level, message }),
    exportTranscript: (suggestedName, content) =>
      ipcRenderer.invoke("app:exportTranscript", { suggestedName, content }),
    revealLog: () => ipcRenderer.invoke("app:revealLog"),
    resetSetup: () => ipcRenderer.invoke("app:resetSetup"),
  },
  onEvent: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: WireEvent) => cb(ev);
    ipcRenderer.on("chat:event", listener);
    return () => {
      ipcRenderer.removeListener("chat:event", listener);
    };
  },
  onAppEvent: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: AppEvent) => cb(ev);
    ipcRenderer.on("app:event", listener);
    return () => {
      ipcRenderer.removeListener("app:event", listener);
    };
  },
};

contextBridge.exposeInMainWorld("hermes", api);