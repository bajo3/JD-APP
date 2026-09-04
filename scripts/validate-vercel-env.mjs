const requiredProductionVariables = [
  "PANEL_ALLOWED_EMAILS",
  "NEXT_PUBLIC_SITE_URL",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_D1_DATABASE_ID",
  "CLOUDFLARE_D1_API_TOKEN",
  "CLOUDFLARE_R2_ENDPOINT",
  "CLOUDFLARE_R2_BUCKET",
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
];

function hasValue(name) {
  return Boolean(process.env[name]?.trim());
}

if (process.env.VERCEL !== "1") {
  console.log("Verificación de entorno Vercel omitida fuera de Vercel.");
  process.exit(0);
}

const missing = requiredProductionVariables.filter((name) => !hasValue(name));

if (missing.length > 0) {
  console.error(
    `Deploy bloqueado: faltan variables de entorno requeridas: ${missing.join(", ")}.`,
  );
  console.error(
    "Configurarlas en Vercel para este entorno antes de volver a desplegar; no usar fixtures en producción.",
  );
  process.exit(1);
}

console.log("Variables obligatorias de Vercel verificadas.");
