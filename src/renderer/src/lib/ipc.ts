import type { HermesApi } from "@shared/wire";

declare global {
  interface Window {
    hermes: HermesApi;
  }
}

export const hermes: HermesApi = window.hermes;