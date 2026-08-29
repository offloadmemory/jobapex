import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { checkpointsPath } from "./paths.js";

/** Durable checkpointer: threads survive process restarts. */
export function createCheckpointer(): SqliteSaver {
  return SqliteSaver.fromConnString(checkpointsPath());
}
