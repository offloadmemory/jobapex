import type { ModelInfo } from "../../../shared/wire.js";
import { discoverAnthropic, validateAnthropic } from "./anthropic.js";
import { discoverOllama, validateOllama } from "./ollama.js";
import { discoverOpenAI, validateOpenAI } from "./openai.js";
import type { DiscoveryTarget } from "./shared.js";

/** List the models a provider offers at its configured base URL. */
export async function discoverModels(target: DiscoveryTarget): Promise<ModelInfo[]> {
  switch (target.type) {
    case "ollama":
      return discoverOllama(target);
    case "openai":
      return discoverOpenAI(target);
    case "anthropic":
      return discoverAnthropic(target);
  }
}

/** Prove the provider answers for this model before the user commits to it. */
export async function validateProvider(target: DiscoveryTarget, model: string): Promise<void> {
  if (!model) throw new Error("Pick a model before testing the connection.");
  switch (target.type) {
    case "ollama":
      return validateOllama(target, model);
    case "openai":
      return validateOpenAI(target, model);
    case "anthropic":
      return validateAnthropic(target, model);
  }
}
