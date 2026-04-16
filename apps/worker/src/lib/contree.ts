import { ContreeClient } from "@opencode-cloud/contree-client";
import type { Env } from "../index.js";

/** Create a ContreeClient configured from the Worker environment bindings. */
export function getContreeClient(env: Env): ContreeClient {
  return new ContreeClient({
    apiKey: env.CONTREE_API_KEY,
  });
}
