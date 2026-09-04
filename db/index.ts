import { drizzle } from "drizzle-orm/d1";
import { RemoteD1Database, RemoteD1Error } from "./d1-remote";
import * as schema from "./schema";

let d1Binding: D1Database | undefined;

export function getD1Binding(): D1Database {
  d1Binding ??= new RemoteD1Database({
    accountId: requiredEnvironment("CLOUDFLARE_ACCOUNT_ID"),
    databaseId: requiredEnvironment("CLOUDFLARE_D1_DATABASE_ID"),
    apiToken: requiredEnvironment("CLOUDFLARE_D1_API_TOKEN"),
  });
  return d1Binding;
}

export function getDb() {
  return drizzle(getD1Binding(), { schema });
}

export type Database = ReturnType<typeof getDb>;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new RemoteD1Error("D1_REMOTE_CONFIG_INVALID");
  return value;
}
