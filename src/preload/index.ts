import { contextBridge, ipcRenderer } from "electron";
import type { HermesApi, WireEvent } from "@shared/wire";

const api: HermesApi = {
  chat: {
    run: (req) => ipcRenderer.invoke("chat:run", req),
    cancel: (threadId) => ipcRenderer.invoke("chat:cancel", { threadId }),
    resolveApproval: (runId, decision) =>
      ipcRenderer.invoke("chat:resolveApproval", { runId, decision }),
  },
  app: {
    getInfo: () => ipcRenderer.invoke("app:getInfo"),
  },
  onEvent: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: WireEvent) => cb(ev);
    ipcRenderer.on("chat:event", listener);
    return () => {
      ipcRenderer.removeListener("chat:event", listener);
    };
  },
};

contextBridge.exposeInMainWorld("hermes", api);