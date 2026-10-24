// Wires the play upload to the real world: the environment (ENV, typed from .env.schema) and Blob.
import { ENV } from "varlock/env";
import { readRateSalt } from "../director/config";
import { type PlayUploadDeps, UPLOADS_PER_DAY, UPLOADS_PER_VISITOR_PER_HOUR } from "./service";
import { createBlobPlayStore } from "./store.blob";

export function createPlayUploadDeps(): PlayUploadDeps {
  return {
    store: createBlobPlayStore(),
    now: () => new Date(),
    rateSalt: readRateSalt(ENV),
    limits: { perVisitorPerHour: UPLOADS_PER_VISITOR_PER_HOUR, perDay: UPLOADS_PER_DAY },
    build: ENV.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
  };
}
