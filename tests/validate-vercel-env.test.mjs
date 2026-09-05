import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const required = {
  VERCEL: "1",
  PANEL_ALLOWED_EMAILS: "operador@jda.test",
  PANEL_ALLOWED_ACCOUNT_IDS: "00000000-0000-4000-8000-000000000001",
  NEXT_PUBLIC_SITE_URL: "https://jda.test",
  SUPABASE_DB_URL: "postgresql://postgres.abc123:secret@aws-0-us-west-2.pooler.supabase.com:5432/postgres",
  CLOUDFLARE_R2_ENDPOINT: "https://account-id-12345678.r2.cloudflarestorage.com",
  CLOUDFLARE_R2_BUCKET: "jda-private",
  CLOUDFLARE_R2_ACCESS_KEY_ID: "r2-access-key",
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: "r2-secret-key",
};

function run(overrides = {}) {
  const environment = { ...process.env, ...required, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[key];
  }
  return spawnSync(process.execPath, ["scripts/validate-vercel-env.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: environment,
    encoding: "utf8",
  });
}

test("el build gate de Vercel exige IDs del panel y nunca imprime sus valores", () => {
  const missing = run({ PANEL_ALLOWED_ACCOUNT_IDS: undefined });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /PANEL_ALLOWED_ACCOUNT_IDS/);
  assert.doesNotMatch(missing.stderr, /00000000-0000-4000-8000-000000000001/);

  const malformed = run({ PANEL_ALLOWED_ACCOUNT_IDS: "id inseguro", PANEL_ALLOWED_EMAILS: "correo-invalido" });
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /PANEL_ALLOWED_EMAILS/);
  assert.match(malformed.stderr, /PANEL_ALLOWED_ACCOUNT_IDS/);
  assert.doesNotMatch(malformed.stderr, /id inseguro|correo-invalido/);
});

test("el build gate rechaza los placeholders .example de plantilla", () => {
  const result = run({
    PANEL_ALLOWED_EMAILS: "equipo@dominio-confirmado.example",
    NEXT_PUBLIC_SITE_URL: "https://tu-dominio-confirmado.example",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PANEL_ALLOWED_EMAILS/);
  assert.match(result.stderr, /NEXT_PUBLIC_SITE_URL/);
});
