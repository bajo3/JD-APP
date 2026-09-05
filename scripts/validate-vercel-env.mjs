const requiredProductionVariables = [
  "PANEL_ALLOWED_EMAILS",
  "PANEL_ALLOWED_ACCOUNT_IDS",
  "NEXT_PUBLIC_SITE_URL",
  "SUPABASE_DB_URL",
  "CLOUDFLARE_R2_ENDPOINT",
  "CLOUDFLARE_R2_BUCKET",
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
];

function hasValue(name) {
  return Boolean(process.env[name]?.trim());
}

const emailPattern = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const accountIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;

function validList(name, pattern) {
  const value = process.env[name]?.trim() ?? "";
  if (!value || value.includes(".example")) return false;
  const entries = value.split(",").map((entry) => entry.trim());
  return entries.length > 0 && entries.every((entry) => pattern.test(entry));
}

if (process.env.VERCEL !== "1") {
  console.log("Verificación de entorno Vercel omitida fuera de Vercel.");
  process.exit(0);
}

const missing = requiredProductionVariables.filter((name) => !hasValue(name));
const malformed = [];
if (hasValue("PANEL_ALLOWED_EMAILS") && !validList("PANEL_ALLOWED_EMAILS", emailPattern)) {
  malformed.push("PANEL_ALLOWED_EMAILS");
}
if (hasValue("PANEL_ALLOWED_ACCOUNT_IDS") && !validList("PANEL_ALLOWED_ACCOUNT_IDS", accountIdPattern)) {
  malformed.push("PANEL_ALLOWED_ACCOUNT_IDS");
}
if (hasValue("NEXT_PUBLIC_SITE_URL") && process.env.NEXT_PUBLIC_SITE_URL.includes(".example")) {
  malformed.push("NEXT_PUBLIC_SITE_URL");
}

if (missing.length > 0 || malformed.length > 0) {
  console.error(
    [
      missing.length > 0 ? `faltan variables requeridas: ${missing.join(", ")}` : "",
      malformed.length > 0 ? `tienen formato inválido: ${malformed.join(", ")}` : "",
    ].filter(Boolean).join("; ") + ".",
  );
  console.error(
    "Configurarlas en Vercel para este entorno antes de volver a desplegar; no usar fixtures en producción.",
  );
  process.exit(1);
}

console.log("Variables obligatorias de Vercel verificadas.");
