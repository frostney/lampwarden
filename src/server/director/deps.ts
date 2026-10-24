// Wires the director service to the real world: environment, the prompt file, Mubit and Blob. The only module of the
// director that reads process.env or a file. The prompt is listed in next.config.ts under outputFileTracingIncludes, so a
// deployed function has it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createMubitClient } from "../../../pipeline/mubit";
import { DECISION_DEADLINE_MILLISECONDS, MODEL_TIMEOUT_MILLISECONDS, readDirectorConfig } from "./config";
import type { DirectorDeps } from "./service";
import { createBlobStore } from "./store.blob";

export function createDirectorDeps(): DirectorDeps {
  const config = readDirectorConfig(process.env);
  return {
    store: createBlobStore(config.blobPrefix, config.playsPrefix),
    now: () => new Date(),
    config,
    // one attempt inside the deadline: a retry would outlast the time the shop is willing to wait
    model: config.mubitApiKey
      ? createMubitClient({
          apiKey: config.mubitApiKey,
          requestTimeoutMilliseconds: MODEL_TIMEOUT_MILLISECONDS,
          retry: false,
        })
      : null,
    prompt: readFileSync(join(/*turbopackIgnore: true*/ process.cwd(), "pipeline", "prompts", "director.md"), "utf8"),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    log: (entry) => console.log(JSON.stringify(entry)),
    deadlineMilliseconds: DECISION_DEADLINE_MILLISECONDS,
  };
}
