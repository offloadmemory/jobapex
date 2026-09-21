import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it, vi } from "vitest";

import type { ResolvedProvider } from "../app/providers.js";
import { activeModelSpec, createChatModel } from "./model-factory.js";
import type { AppConfig } from "./config.js";

// The provider table lives in app.sqlite; swapping the lookup keeps these
// mapping tests deterministic and off the real home directory.
const active = vi.hoisted(() => ({ provider: null as ResolvedProvider | null }));

vi.mock("../app/providers.js", () => ({
  resolveActiveProvider: () => active.provider,
}));

const CONFIG: AppConfig = {
  model: "config-model",
  baseUrl: "http://config.test:11434",
  workspaceDir: "/tmp/workspace",
  memfs: false,
  yolo: false,
  think: true,
};

describe("activeModelSpec", () => {
  it("falls back to the config when no provider row is active", () => {
    active.provider = null;
    expect(activeModelSpec(CONFIG)).toEqual({
      type: "ollama",
      model: "config-model",
      baseUrl: "http://config.test:11434",
      apiKey: null,
      think: true,
    });
  });

  it("prefers the provider row, keeping the config's think flag", () => {
    active.provider = {
      id: "p1",
      name: "OpenAI",
      type: "openai",
      baseUrl: "https://api.openai.test/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-test",
    };
    expect(activeModelSpec(CONFIG)).toEqual({
      type: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.test/v1",
      apiKey: "sk-test",
      think: true,
    });
  });
});

describe("createChatModel", () => {
  it("maps an ollama spec onto ChatOllama with its model, base URL and think flag", () => {
    const model = createChatModel({
      type: "ollama",
      model: "glm-5.2:cloud",
      baseUrl: "http://localhost:11434",
      apiKey: null,
      think: true,
    });
    if (!(model instanceof ChatOllama)) throw new Error("expected a ChatOllama");
    expect(model.model).toBe("glm-5.2:cloud");
    expect(model.baseUrl).toBe("http://localhost:11434");
    expect(model.think).toBe(true);
  });

  it("maps an openai spec onto ChatOpenAI with the base URL in its client config", () => {
    const model = createChatModel({
      type: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.test/v1",
      apiKey: "sk-test",
      think: false,
    });
    if (!(model instanceof ChatOpenAI)) throw new Error("expected a ChatOpenAI");
    expect(model.model).toBe("gpt-4o-mini");
    expect(model.clientConfig.baseURL).toBe("https://api.openai.test/v1");
  });

  it("maps an anthropic spec onto ChatAnthropic with the base URL in its client options", () => {
    const model = createChatModel({
      type: "anthropic",
      model: "claude-sonnet-4-5",
      baseUrl: "https://api.anthropic.test",
      apiKey: "sk-ant-test",
      think: false,
    });
    if (!(model instanceof ChatAnthropic)) throw new Error("expected a ChatAnthropic");
    expect(model.model).toBe("claude-sonnet-4-5");
    expect(model.clientOptions?.baseURL).toBe("https://api.anthropic.test");
  });

  it("refuses to build a keyless non-ollama provider", () => {
    expect(() =>
      createChatModel({
        type: "openai",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.test/v1",
        apiKey: null,
        think: false,
      })
    ).toThrow(/has no API key/);
  });
});
