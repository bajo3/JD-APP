import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type RuntimeBindings = {
  DB?: D1Database;
  uploads?: R2Bucket;
};

function bindings(): RuntimeBindings {
  return env as unknown as RuntimeBindings;
}

export function getD1Binding(): D1Database {
  const d1 = bindings().DB;

  if (!d1) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return d1;
}

export function getUploadsBucket(): R2Bucket {
  const bucket = bindings().uploads;

  if (!bucket) {
    throw new Error(
      "Cloudflare R2 binding `uploads` is unavailable. Set the `r2` field in .openai/hosting.json to `uploads` before using object storage."
    );
  }

  return bucket;
}

export function getDb() {
  return drizzle(getD1Binding(), { schema });
}

export type Database = ReturnType<typeof getDb>;
