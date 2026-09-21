import { describe, expect, it } from "vitest";

import { parseOllamaTags } from "./ollama.js";

describe("parseOllamaTags", () => {
  it("lists every tag name as both id and label", () => {
    expect(parseOllamaTags({ models: [{ name: "glm-5.2:cloud" }, { name: "qwen3:8b" }] })).toEqual([
      { id: "glm-5.2:cloud", label: "glm-5.2:cloud" },
      { id: "qwen3:8b", label: "qwen3:8b" },
    ]);
  });

  it("falls back to the model field when name is absent", () => {
    expect(parseOllamaTags({ models: [{ model: "legacy:1b" }] })).toEqual([
      { id: "legacy:1b", label: "legacy:1b" },
    ]);
  });

  it("skips entries that carry neither a name nor a model", () => {
    expect(parseOllamaTags({ models: [{}, { name: "" }, { size: 12 }, { name: "kept" }] })).toEqual([
      { id: "kept", label: "kept" },
    ]);
  });

  it("ignores the rest of Ollama's per-model metadata", () => {
    const payload = {
      models: [
        {
          name: "glm-5.2:cloud",
          model: "glm-5.2:cloud",
          modified_at: "2026-01-01T00:00:00Z",
          size: 4_000_000,
          digest: "abc",
        },
      ],
    };

    expect(parseOllamaTags(payload)).toEqual([{ id: "glm-5.2:cloud", label: "glm-5.2:cloud" }]);
  });

  it("lists no models for an unreadable payload", () => {
    const payloads = [undefined, null, 42, "models", [], { models: "glm" }, { models: [1, null] }];
    for (const payload of payloads) {
      expect(parseOllamaTags(payload)).toEqual([]);
    }
  });

  it("rejects the whole payload when one model is malformed", () => {
    expect(parseOllamaTags({ models: [{ name: "good" }, { name: 5 }] })).toEqual([]);
  });

  it("lists no models when the models key is missing", () => {
    expect(parseOllamaTags({})).toEqual([]);
  });
});
