// Shared runtime resolution for the data-maintenance commands.
//
// The application is hosted on Vercel, but Wrangler remains useful for D1/R2
// maintenance and drills.  Keep its local bindings in a small, versioned
// source config instead of depending on a build artifact produced by Vinext.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

export const LOCAL_D1_DATABASE_ID = "00000000-0000-4000-8000-000000000000";
export const LOCAL_D1_DATABASE_NAME = "site-creator-d1";
export const LOCAL_R2_BUCKET = "site-creator-r2";
export const DATA_CONFIG_FILE = "wrangler.data.json";

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Falta la variable de entorno ${name}.`);
  }
  return value.trim();
}

function validBindingName(value) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
}

function readConfig(configPath) {
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new Error(`La configuración de datos no es JSON válido: ${DATA_CONFIG_FILE}.`);
  }
  if (!Array.isArray(config.d1_databases) || !Array.isArray(config.r2_buckets)) {
    throw new Error(`${DATA_CONFIG_FILE} debe declarar bindings D1 y R2.`);
  }
  return config;
}

function findWrangler(projectRoot) {
  const local = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
  if (existsSync(local)) return local;
  const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "wrangler", "bin", "wrangler.js");
  if (existsSync(repository)) return repository;
  throw new Error("No se encontró Wrangler. Corré `npm install`.");
}

function loadProjectEnvironment(projectRoot) {
  // @next/env parses .env, .env.local and their environment-specific variants
  // using the same rules as Next.  Its callbacks are silenced so values never
  // appear in command output.
  loadEnvConfig(projectRoot, false, { info: () => {}, error: () => {} });
  return process.env;
}

export function resolveDataRuntime(options = {}, projectRoot) {
  const root = projectRoot ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  const database = options.database ?? "DB";
  if (!validBindingName(database)) throw new Error("Invalid D1 database name.");

  const configPath = join(root, DATA_CONFIG_FILE);
  if (!existsSync(configPath)) {
    throw new Error(`No se encontró ${DATA_CONFIG_FILE}.`);
  }
  const localConfig = readConfig(configPath);
  const d1 = localConfig.d1_databases.find((binding) => binding?.binding === database);
  if (!d1) throw new Error(`D1 binding ${database} no está declarado en ${DATA_CONFIG_FILE}.`);
  const r2 = localConfig.r2_buckets.find((binding) => binding?.binding === "uploads");
  if (options.requireR2 === true && !r2) {
    throw new Error(`R2 binding uploads no está declarado en ${DATA_CONFIG_FILE}.`);
  }

  const wrangler = findWrangler(root);
  const persistPath = join(root, ".wrangler", "state");
  const remote = options.remote === true;
  let resolvedConfigPath = configPath;
  let cleanup = () => {};
  let bucket = r2?.bucket_name ?? null;
  let wranglerEnv = { ...process.env };
  let r2Config = null;

  if (remote) {
    const env = loadProjectEnvironment(root);
    const accountId = requiredString(env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID");
    const databaseId = requiredString(env.CLOUDFLARE_D1_DATABASE_ID, "CLOUDFLARE_D1_DATABASE_ID");
    const apiToken = requiredString(env.CLOUDFLARE_D1_API_TOKEN, "CLOUDFLARE_D1_API_TOKEN");
    if (options.requireR2 === true) {
      bucket = requiredString(env.CLOUDFLARE_R2_BUCKET, "CLOUDFLARE_R2_BUCKET");
      r2Config = Object.freeze({
        endpoint: requiredString(env.CLOUDFLARE_R2_ENDPOINT, "CLOUDFLARE_R2_ENDPOINT"),
        accessKeyId: requiredString(env.CLOUDFLARE_R2_ACCESS_KEY_ID, "CLOUDFLARE_R2_ACCESS_KEY_ID"),
        secretAccessKey: requiredString(
          env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
          "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
        ),
      });
    }

    const remoteConfig = {
      ...localConfig,
      account_id: accountId,
      d1_databases: localConfig.d1_databases.map((binding) =>
        binding?.binding === database
          ? { ...binding, database_id: databaseId }
          : binding,
      ),
      r2_buckets:
        options.requireR2 === true
          ? localConfig.r2_buckets.map((binding) =>
              binding?.binding === "uploads" ? { ...binding, bucket_name: bucket } : binding,
            )
          : localConfig.r2_buckets,
    };
    const tempDir = mkdtempSync(join(tmpdir(), "jda-data-config-"));
    resolvedConfigPath = join(tempDir, DATA_CONFIG_FILE);
    writeFileSync(resolvedConfigPath, `${JSON.stringify(remoteConfig, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    cleanup = () => rmSync(tempDir, { recursive: true, force: true });

    // Wrangler's standard variable is intentionally scoped to child processes.
    // It is never written to the config or appended to command arguments.
    wranglerEnv = { ...process.env, CLOUDFLARE_API_TOKEN: apiToken, CLOUDFLARE_ACCOUNT_ID: accountId };
  }

  return {
    ...options,
    database,
    remote,
    bucket,
    configPath: resolvedConfigPath,
    localConfigPath: configPath,
    wrangler,
    projectRoot: root,
    persistPath,
    wranglerEnv,
    r2Config,
    cleanup,
  };
}
