import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import type { ProviderType } from "../../shared/wire.js";
import { resolveActiveProvider } from "../app/providers.js";
import type { AppConfig } from "./config.js";

export interface ModelSpec {
  type: ProviderType;
  model: string;
  baseUrl: string;
  apiKey: string | null;
  /** Ollama only: surface reasoning as separate thinking tokens. */
  think: boolean;
}

/**
 * Provider resolution order: the default provider row, then config.json / env
 * (AppConfig), then the Ollama defaults baked into AppConfig. Resolved
 * synchronously so buildAgent stays synchronous for script callers.
 */
export function activeModelSpec(cfg: AppConfig): ModelSpec {
  const provider = resolveActiveProvider();
  if (!provider) {
    return { type: "ollama", model: cfg.model, baseUrl: cfg.baseUrl, apiKey: null, think: cfg.think };
  }
  return {
    type: provider.type,
    model: provider.model,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    think: cfg.think,
  };
}

function requireApiKey(spec: ModelSpec): string {
  if (!spec.apiKey) {
    throw new Error(
      `The ${spec.type} provider "${spec.model}" has no API key. Add one in Settings.`
    );
  }
  return spec.apiKey;
}

export function createChatModel(spec: ModelSpec): BaseChatModel {
  switch (spec.type) {
    case "ollama":
      return new ChatOllama({ model: spec.model, baseUrl: spec.baseUrl, think: spec.think });
    case "openai":
      return new ChatOpenAI({
        model: spec.model,
        apiKey: requireApiKey(spec),
        configuration: { baseURL: spec.baseUrl },
      });
    case "anthropic":
      return new ChatAnthropic({
        model: spec.model,
        apiKey: requireApiKey(spec),
        clientOptions: { baseURL: spec.baseUrl },
      });
  }
}
