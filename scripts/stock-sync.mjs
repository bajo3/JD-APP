// Sincroniza el stock real de JD-Auto hacia la D1 y el R2 de esta web.
//
// Las tres fuentes viven en el proyecto JD-Auto y cada una aporta lo suyo:
//   - la planilla publicada de JDA es la verdad del precio y de la moneda
//     (la sheet escribe "34.500 USD" o "$22.300.000"; Supabase guarda sólo el
//     número y pierde la moneda, así que el precio nunca se lee de ahí);
//   - Supabase (schema jda) aporta la identidad de la unidad y el índice de
//     fotos, con el mismo unit_id que genera la planilla;
//   - el disco local guarda las fotos originales que sirve el panel de JD-Auto.
//
// Nada se infiere: una unidad sin precio legible, sin moneda declarada, sin
// año, sin kilometraje, sin versión o sin fotos se rechaza con su motivo y no
// se publica. El precio publicado es el de lista, según la decisión de JDA.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { resolveDataRuntime } from "./data-runtime.mjs";

export const PROVIDER = "jd-auto";
export const DEFAULT_PHOTO_LIMIT = 12;
export const PHOTO_MAX_EDGE = 1_600;
export const PHOTO_QUALITY = 82;

// ── Planilla ───────────────────────────────────────────────────────────────

function cleanText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normKey(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[/-]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function parseSheet(text) {
  const lines = String(text).replace(/^\ufeff/, "").split(/\r?\n/);
  if (lines.length === 0) return [];
  const header = lines[0].split("\t").map((cell) => normKey(cell));
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row = {};
    header.forEach((key, index) => {
      if (key) row[key] = cleanText(cells[index]);
    });
    return row;
  });
}

function parseYear(raw) {
  const match = cleanText(raw).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function parseKm(raw) {
  const text = cleanText(raw);
  if (!text) return null;
  if (/^0\s*km/i.test(text)) return 0;
  if (!/\d/.test(text)) return null;
  const digits = text.replace(/[^\d]/g, "");
  if (!digits) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Lee un importe conservando la moneda que declara la planilla. Devuelve el
 * motivo cuando la celda no permite decidir: un precio sin moneda o con un
 * tipeo (`$!4000000`) se rechaza en lugar de adivinarse.
 */
export function parsePriceCell(raw) {
  const text = cleanText(raw);
  if (!text) return { ok: false, reason: "precio_vacio" };
  const currency = /usd|u\$s|d[oó]lar/i.test(text) ? "USD" : /\$/.test(text) ? "ARS" : null;
  if (!currency) return { ok: false, reason: "moneda_no_declarada", text };
  const body = text
    .replace(/usd|u\$s|d[oó]lares?|d[oó]lar/gi, "")
    .replace(/\$/g, "")
    .trim();
  if (/[^\d.,\s]/.test(body)) return { ok: false, reason: "precio_ilegible", text };
  const digits = body.replace(/[.,\s]/g, "");
  if (!/^\d+$/.test(digits)) return { ok: false, reason: "precio_ilegible", text };
  const amount = Number.parseInt(digits, 10);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, reason: "precio_ilegible", text };
  }
  // Los precios de prueba que el bot de Marketplace usa como placeholder nunca
  // llegan a la web.
  if (amount <= 10) return { ok: false, reason: "precio_placeholder", text };
  return { ok: true, currency, cents: amount * 100, text };
}

function slugUnderscore(parts) {
  return (
    parts
      .map((part) => cleanText(part))
      .filter(Boolean)
      .join("_")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || "vehiculo"
  );
}

function looksLikeBrandRow(unit, year, km, version) {
  if (!unit || year || km || version) return false;
  const words = unit.replace(/[.-]/g, " ").split(/\s+/).filter(Boolean);
  return words.length > 0 && !words.some((word) => /\d/.test(word));
}

function looksLikeNoiseRow(unit, cash, credit) {
  const joined = [unit, cash, credit].join(" ").trim().toUpperCase();
  return joined === "CONTADO CON" || joined === "CHEVROLET CREDITO PERMUTA";
}

/**
 * Reproduce el unit_id que genera JD-Auto al importar la planilla —marca de la
 * fila de encabezado + unidad + versión + año, con el mismo desempate— porque
 * ese identificador es la única llave estable contra Supabase y sus fotos.
 */
export function mapSheetUnits(rows) {
  let brand = "";
  const seen = new Map();
  const units = [];

  rows.forEach((row, index) => {
    const unit = row.unidad ?? "";
    const yearRaw = row.ano ?? row.anio ?? "";
    const kmRaw = row.km ?? "";
    const version = row.version ?? "";
    const cashRaw = row.precio_contado ?? "";
    const listRaw = row.precio_lista ?? "";

    if (Object.values(row).every((value) => !value)) return;
    if (looksLikeNoiseRow(unit, cashRaw, listRaw)) return;
    if (looksLikeBrandRow(unit, yearRaw, kmRaw, version)) {
      brand = unit;
      return;
    }
    if (!brand || !unit) return;

    const year = parseYear(yearRaw);
    const base = slugUnderscore([brand, unit, version, year]);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);

    units.push({
      unitId: count === 1 ? base : `${base}_${count}`,
      sheetRow: index + 2,
      brand,
      model: unit,
      version,
      year,
      km: parseKm(kmRaw),
      color: row.color ?? "",
      fuel: row.combustible ?? "",
      traction: row.traccion ?? "",
      transmission: row.caja ?? "",
      engine: row.cilindrada ?? "",
      listPrice: parsePriceCell(listRaw),
      cashPrice: parsePriceCell(cashRaw),
    });
  });

  return units;
}

// ── Normalización hacia el modelo de la web ────────────────────────────────

export function publicSlug(unitId) {
  return unitId.replace(/_/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function normalizeTransmission(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return "";
  if (/^at\b|autom/.test(text)) return "Automática";
  if (/^mt\b|manual/.test(text)) return "Manual";
  return cleanText(value);
}

function titleCase(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/(^|[\s/-])([a-záéíóúñ])/g, (_, prefix, letter) => prefix + letter.toUpperCase());
}

export function photoKind(url) {
  const match = /[?&]kind=([^&]+)/i.exec(String(url));
  const kind = match ? match[1].toLowerCase() : "";
  if (kind === "raw" || kind === "unedited") return "raw";
  if (kind === "edited" || kind === "marketplace_edited") return "edited";
  if (kind === "story") return "story";
  return "unknown";
}

export function photoFileName(url) {
  const path = String(url).split("?")[0];
  return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
}

/**
 * Decide qué se publica y qué queda afuera. Las fotos "editadas" son piezas
 * cuadradas con marco de marca y el modelo escrito encima: sirven para redes y
 * no para la ficha, así que la web publica las originales.
 */
export function planStockSync({ units, vehicles, photoLimit = DEFAULT_PHOTO_LIMIT }) {
  const bySupabaseUnitId = new Map(
    vehicles.filter((vehicle) => vehicle.unit_id).map((vehicle) => [vehicle.unit_id, vehicle]),
  );
  const accepted = [];
  const rejected = [];

  for (const unit of units) {
    const vehicle = bySupabaseUnitId.get(unit.unitId);
    const reject = (reason, detail) =>
      rejected.push({ unitId: unit.unitId, sheetRow: unit.sheetRow, reason, detail });

    if (!vehicle) {
      reject("sin_ficha_en_jd_auto", "La planilla la lista pero JD-Auto no tiene la unidad cargada.");
      continue;
    }
    if (vehicle.status !== "active") {
      reject("no_activa_en_jd_auto", `Estado en JD-Auto: ${vehicle.status}.`);
      continue;
    }
    if (!unit.listPrice.ok) {
      reject(unit.listPrice.reason, `PRECIO LISTA: ${unit.listPrice.text ?? "(vacío)"}`);
      continue;
    }
    if (unit.year === null) {
      reject("sin_anio", "La planilla no informa el año.");
      continue;
    }
    if (unit.km === null) {
      reject("sin_kilometraje", "La planilla no informa el kilometraje.");
      continue;
    }
    if (!unit.version) {
      reject("sin_version", "La planilla no informa la versión.");
      continue;
    }

    const photos = (vehicle.vehicle_photos ?? [])
      .filter((photo) => photoKind(photo.url) === "raw")
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
      .slice(0, photoLimit)
      .map((photo, index) => ({
        fileName: photoFileName(photo.url),
        sortOrder: index,
      }));

    if (photos.length === 0) {
      reject("sin_fotos_originales", "La unidad sólo tiene piezas editadas para redes.");
      continue;
    }

    const record = {
      externalCode: unit.unitId,
      slug: publicSlug(unit.unitId),
      make: titleCase(unit.brand),
      model: titleCase(unit.model),
      trim: cleanText(unit.version),
      year: unit.year,
      mileageKm: unit.km,
      priceCents: unit.listPrice.cents,
      currency: unit.listPrice.currency,
      // La planilla no informa carrocería. Se publica el tipo neutro en lugar
      // de deducirlo del modelo; la columna está pedida en DECISIONES_JDA.
      bodyType: "auto",
      fuelType: titleCase(unit.fuel) || "No informado",
      transmission: normalizeTransmission(unit.transmission) || "No informada",
      color: titleCase(unit.color) || "No informado",
    };

    accepted.push({
      unitId: unit.unitId,
      sheetRow: unit.sheetRow,
      supabaseVehicleId: vehicle.id,
      record,
      photos,
      payloadHash: hashPayload({ ...record, photos: photos.map((photo) => photo.fileName) }),
    });
  }

  return { accepted, rejected };
}

export function hashPayload(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// ── SQL ────────────────────────────────────────────────────────────────────

function literal(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("Sync numbers must be safe integers");
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function auditRow({ id, action, resourceType, resourceId, summary, occurredAt, actor }) {
  return `INSERT INTO admin_audit_log (id, actor_user_id, actor_email, action, resource_type, resource_id, previous_version, next_version, summary_json, occurred_at) VALUES (${[
    literal(id),
    literal(actor.userId),
    literal(actor.email),
    literal(action),
    literal(resourceType),
    literal(resourceId),
    "NULL",
    "NULL",
    literal(JSON.stringify(summary)),
    literal(occurredAt),
  ].join(", ")});`;
}

/**
 * Arma el lote de la corrida. Cada unidad se identifica por `external_code`,
 * conserva su `id` y su `version` cuando ya existía y deja auditoría; no hay
 * borrados físicos: lo que desaparece de la planilla se pausa.
 */
export function buildSyncSql({
  runId,
  accepted,
  rejected,
  existing,
  media,
  startedAt,
  finishedAt,
  actor,
  idFactory,
}) {
  const statements = [];
  const existingByCode = new Map(existing.map((row) => [row.external_code, row]));
  const seenCodes = new Set(accepted.map((item) => item.externalCode ?? item.unitId));
  let changed = 0;

  for (const item of accepted) {
    const record = item.record;
    const current = existingByCode.get(item.unitId);
    const vehicleId = current?.id ?? idFactory(`vehicle:${item.unitId}`);
    const unchanged = current?.sync_hash === item.payloadHash;

    if (!current) {
      statements.push(
        `INSERT INTO vehicle (id, slug, external_code, make, model, trim, year, mileage_km, price_cents, currency, body_type, fuel_type, transmission, color, status, source, last_synced_at, published_at, version, created_at, updated_at) VALUES (${[
          literal(vehicleId),
          literal(record.slug),
          literal(item.unitId),
          literal(record.make),
          literal(record.model),
          literal(record.trim),
          literal(record.year),
          literal(record.mileageKm),
          literal(record.priceCents),
          literal(record.currency),
          literal(record.bodyType),
          literal(record.fuelType),
          literal(record.transmission),
          literal(record.color),
          literal("AVAILABLE"),
          literal(PROVIDER),
          literal(finishedAt),
          literal(finishedAt),
          "1",
          literal(finishedAt),
          literal(finishedAt),
        ].join(", ")});`,
      );
      statements.push(
        auditRow({
          id: idFactory(`audit:create:${item.unitId}:${runId}`),
          action: "VEHICLE_SYNCED_CREATED",
          resourceType: "VEHICLE",
          resourceId: vehicleId,
          summary: { provider: PROVIDER, externalCode: item.unitId, runId },
          occurredAt: finishedAt,
          actor,
        }),
      );
      changed += 1;
    } else if (unchanged) {
      // Sólo se refresca la marca de frescura: sin cambio de datos no se toca
      // la versión ni se deja auditoría de una edición que no existió.
      statements.push(
        `UPDATE vehicle SET last_synced_at = ${literal(finishedAt)} WHERE id = ${literal(vehicleId)};`,
      );
    } else {
      statements.push(
        `UPDATE vehicle SET slug = ${literal(record.slug)}, make = ${literal(record.make)}, model = ${literal(record.model)}, trim = ${literal(record.trim)}, year = ${literal(record.year)}, mileage_km = ${literal(record.mileageKm)}, price_cents = ${literal(record.priceCents)}, currency = ${literal(record.currency)}, body_type = ${literal(record.bodyType)}, fuel_type = ${literal(record.fuelType)}, transmission = ${literal(record.transmission)}, color = ${literal(record.color)}, status = CASE WHEN status IN ('SOLD','RESERVED','ARCHIVED') THEN status ELSE 'AVAILABLE' END, source = ${literal(PROVIDER)}, last_synced_at = ${literal(finishedAt)}, version = version + 1, updated_at = ${literal(finishedAt)} WHERE id = ${literal(vehicleId)};`,
      );
      if (current.price_cents !== record.priceCents || current.currency !== record.currency) {
        statements.push(
          `INSERT INTO vehicle_price_history (id, vehicle_id, price_cents, currency, valid_from, valid_until, changed_by, change_reason, created_at) VALUES (${[
            literal(idFactory(`price:${item.unitId}:${runId}`)),
            literal(vehicleId),
            literal(record.priceCents),
            literal(record.currency),
            literal(finishedAt),
            "NULL",
            literal(actor.email),
            literal(`Sincronización ${PROVIDER} (planilla fila ${item.sheetRow})`),
            literal(finishedAt),
          ].join(", ")});`,
        );
      }
      statements.push(
        auditRow({
          id: idFactory(`audit:update:${item.unitId}:${runId}`),
          action: "VEHICLE_SYNCED_UPDATED",
          resourceType: "VEHICLE",
          resourceId: vehicleId,
          summary: { provider: PROVIDER, externalCode: item.unitId, runId },
          occurredAt: finishedAt,
          actor,
        }),
      );
      changed += 1;
    }

    statements.push(
      `INSERT INTO external_stock_mapping (id, vehicle_id, provider, external_id, payload_hash, last_seen_at, created_at, updated_at) VALUES (${[
        literal(idFactory(`map:${item.unitId}`)),
        literal(vehicleId),
        literal(PROVIDER),
        literal(item.unitId),
        literal(item.payloadHash),
        literal(finishedAt),
        literal(finishedAt),
        literal(finishedAt),
      ].join(", ")}) ON CONFLICT(provider, external_id) DO UPDATE SET vehicle_id = excluded.vehicle_id, payload_hash = excluded.payload_hash, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at;`,
    );

    item.vehicleId = vehicleId;
  }

  // Lo que ya no figura en la planilla se pausa: deja de ofrecerse sin borrar
  // el historial ni las fotos.
  for (const row of existing) {
    if (seenCodes.has(row.external_code)) continue;
    if (row.status !== "AVAILABLE") continue;
    statements.push(
      `UPDATE vehicle SET status = 'PAUSED', version = version + 1, updated_at = ${literal(finishedAt)} WHERE id = ${literal(row.id)};`,
    );
    statements.push(
      auditRow({
        id: idFactory(`audit:pause:${row.external_code}:${runId}`),
        action: "VEHICLE_SYNCED_PAUSED",
        resourceType: "VEHICLE",
        resourceId: row.id,
        summary: { provider: PROVIDER, externalCode: row.external_code, runId, reason: "fuera_de_planilla" },
        occurredAt: finishedAt,
        actor,
      }),
    );
    changed += 1;
  }

  for (const photo of media) {
    statements.push(
      `INSERT INTO vehicle_media (id, vehicle_id, r2_key, public_url, content_type, alt_text, byte_size, sha256, status, sort_order, width, height, version, uploaded_by, created_at, updated_at, archived_at) VALUES (${[
        literal(photo.mediaId),
        literal(photo.vehicleId),
        literal(photo.r2Key),
        literal(`/api/v1/media/vehicles/${photo.mediaId}`),
        literal(photo.contentType),
        literal(photo.altText),
        literal(photo.byteSize),
        literal(photo.sha256),
        literal("READY"),
        literal(photo.sortOrder),
        literal(photo.width),
        literal(photo.height),
        "1",
        literal(actor.email),
        literal(finishedAt),
        literal(finishedAt),
        "NULL",
      ].join(", ")}) ON CONFLICT(vehicle_id, sha256) DO UPDATE SET sort_order = excluded.sort_order, alt_text = excluded.alt_text, status = 'READY', archived_at = NULL, updated_at = excluded.updated_at;`,
    );
  }

  statements.push(
    `INSERT INTO stock_sync_run (id, provider, status, started_at, finished_at, records_seen, records_changed, error_code, error_summary, created_at) VALUES (${[
      literal(runId),
      literal(PROVIDER),
      literal(rejected.length === 0 ? "COMPLETED" : "COMPLETED_WITH_REJECTIONS"),
      literal(startedAt),
      literal(finishedAt),
      literal(accepted.length + rejected.length),
      literal(changed),
      rejected.length === 0 ? "NULL" : literal("UNITS_REJECTED"),
      rejected.length === 0
        ? "NULL"
        : literal(
            rejected
              .map((item) => `${item.unitId}: ${item.reason}`)
              .join(" | ")
              .slice(0, 2_000),
          ),
      literal(finishedAt),
    ].join(", ")});`,
  );

  return { sql: statements.join("\n"), changed };
}

// ── Ejecución ──────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  if (!dryRun && !argv.includes("--confirm-remote")) {
    throw new Error("Sincronizar contra Supabase requiere el flag explícito --confirm-remote.");
  }
  const flagValue = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  const photoLimit = Number(flagValue("--photos", String(DEFAULT_PHOTO_LIMIT)));
  if (!Number.isSafeInteger(photoLimit) || photoLimit < 1 || photoLimit > 40) {
    throw new Error("--photos admite un entero entre 1 y 40.");
  }
  return {
    remote: true,
    confirmRemote: true,
    dryRun,
    skipPhotos: argv.includes("--skip-photos"),
    photoLimit,
    jdAutoDir: flagValue("--jd-auto", process.env.JD_AUTO_DIR ?? null),
  };
}

function readDotEnv(path) {
  if (!existsSync(path)) throw new Error(`No se encontró el .env de JD-Auto en ${path}`);
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`La configuración requerida ${name} no está disponible.`);
  return value;
}

function resolveRuntime(options, projectRoot) {
  const dataRuntime = resolveDataRuntime(options);

  const jdAutoDir = resolve(options.jdAutoDir ?? join(projectRoot, "..", "JD-Auto"));
  const env = readDotEnv(join(jdAutoDir, ".env"));
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("El .env de JD-Auto no define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
  }
  const sheetUrl = (env.SHEET_TSV_URL ?? env.SHEETS_TSV_URL ?? env.SHEETS_CSV_URL ?? "").replace(
    /output=csv/,
    "output=tsv",
  );
  if (!sheetUrl) throw new Error("El .env de JD-Auto no define la URL de la planilla publicada.");

  return {
    ...dataRuntime,
    projectRoot,
    jdAutoDir,
    uploadsDir: resolve(env.UPLOADS_DIR ?? join(jdAutoDir, "apps", "api", "data", "uploads")),
    supabaseUrl,
    supabaseKey,
    sheetUrl,
    // La misma cuenta de object storage que sirve las fotos publicadas
    // (lib/data/storage.ts): no hay un almacenamiento "local" propio de este
    // script, así que la sincronización siempre escribe ahí.
    bucket: requiredEnvironment("CLOUDFLARE_R2_BUCKET"),
    r2Config: {
      endpoint: requiredEnvironment("CLOUDFLARE_R2_ENDPOINT"),
      accessKeyId: requiredEnvironment("CLOUDFLARE_R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnvironment("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
    },
  };
}

async function r2Put(runtime, key, file, contentType) {
  runtime.r2Client ??= new S3Client({
    region: "auto",
    endpoint: runtime.r2Config.endpoint,
    credentials: {
      accessKeyId: runtime.r2Config.accessKeyId,
      secretAccessKey: runtime.r2Config.secretAccessKey,
    },
  });
  try {
    await runtime.r2Client.send(
      new PutObjectCommand({
        Bucket: runtime.bucket,
        Key: key,
        Body: readFileSync(file),
        ContentType: contentType,
      }),
    );
  } catch {
    throw new Error("No se pudo escribir la foto en el object storage.");
  }
}

async function fetchSheetUnits(runtime) {
  const response = await fetch(runtime.sheetUrl, { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`No se pudo leer la planilla: ${response.status}`);
  return mapSheetUnits(parseSheet(await response.text()));
}

async function fetchSupabaseVehicles(runtime) {
  const url = new URL(`${runtime.supabaseUrl}/rest/v1/vehicles`);
  url.searchParams.set("select", "id,unit_id,status,vehicle_photos(url,position,is_corrupt)");
  url.searchParams.set("status", "eq.active");
  const response = await fetch(url, {
    headers: {
      apikey: runtime.supabaseKey,
      Authorization: `Bearer ${runtime.supabaseKey}`,
      "Accept-Profile": "jda",
    },
  });
  if (!response.ok) {
    throw new Error(`No se pudo leer Supabase: ${response.status}`);
  }
  const rows = await response.json();
  return rows.map((row) => ({
    ...row,
    vehicle_photos: (row.vehicle_photos ?? []).filter((photo) => !photo.is_corrupt),
  }));
}

async function preparePhotos(runtime, accepted, tempDir) {
  const { default: sharp } = await import("sharp");
  const { inspectStockImage } = await import("../lib/media/index.mjs");
  const media = [];
  const failures = [];

  for (const item of accepted) {
    for (const photo of item.photos) {
      const source = join(runtime.uploadsDir, "vehicles", item.supabaseVehicleId, photo.fileName);
      if (!existsSync(source)) {
        failures.push({ unitId: item.unitId, fileName: photo.fileName, reason: "archivo_ausente" });
        continue;
      }
      try {
        // sharp descarta los metadatos al reencodear, así que la foto se
        // publica sin EXIF ni ubicación de origen.
        const pipeline = sharp(source)
          .rotate()
          .resize({
            width: PHOTO_MAX_EDGE,
            height: PHOTO_MAX_EDGE,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: PHOTO_QUALITY, mozjpeg: true });
        const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
        const inspection = await inspectStockImage({
          bytes: data,
          declaredContentType: "image/jpeg",
        });
        const mediaId = `md-${inspection.sha256.slice(0, 28)}`;
        const file = join(tempDir, `${mediaId}.jpg`);
        writeFileSync(file, data);
        media.push({
          mediaId,
          vehicleId: item.vehicleId,
          r2Key: `public/stock/${item.vehicleId}/${mediaId}`,
          contentType: inspection.contentType,
          byteSize: inspection.byteSize,
          sha256: inspection.sha256,
          width: info.width,
          height: info.height,
          sortOrder: photo.sortOrder,
          altText: `${item.record.make} ${item.record.model} ${item.record.trim} ${item.record.year} — foto ${photo.sortOrder + 1}`,
          file,
        });
      } catch (error) {
        failures.push({
          unitId: item.unitId,
          fileName: photo.fileName,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { media, failures };
}

function report(title, rows) {
  if (rows.length === 0) return;
  console.log(`\n${title}`);
  for (const row of rows) console.log(`  ${row}`);
}

export async function runStockSync(argv = process.argv.slice(2)) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const runtime = resolveRuntime(parseArgs(argv), join(scriptDir, ".."));
  try {
    const startedAt = new Date().toISOString();
    const actor = Object.freeze({
      userId: `sync:${PROVIDER}`,
      email: `sync@${PROVIDER}.local`,
      displayName: "Sincronización JD-Auto",
    });

    const [units, vehicles] = await Promise.all([
      fetchSheetUnits(runtime),
      fetchSupabaseVehicles(runtime),
    ]);
    const { accepted, rejected } = planStockSync({
      units,
      vehicles,
      photoLimit: runtime.photoLimit,
    });

    console.log(
      `Planilla: ${units.length} unidades · JD-Auto activas: ${vehicles.length} · publicables: ${accepted.length} · rechazadas: ${rejected.length}`,
    );
    report(
      "Publicables:",
      accepted.map(
        (item) =>
          `${item.unitId} — ${item.record.make} ${item.record.model} ${item.record.trim} ${item.record.year} · ${(item.record.priceCents / 100).toLocaleString("es-AR")} ${item.record.currency} · ${item.photos.length} fotos`,
      ),
    );
    report(
      "Rechazadas (no se publican):",
      rejected.map((item) => `${item.unitId} (fila ${item.sheetRow}) — ${item.reason}: ${item.detail}`),
    );

    if (runtime.dryRun) {
      console.log("\n--dry-run: no se escribió nada.");
      return { accepted, rejected, written: false };
    }

    const existing = [
      ...(await runtime.sql.unsafe(
        "SELECT id, external_code, status, price_cents, currency FROM vehicle WHERE source = 'jd-auto'",
      )),
    ];
    const withHashes = [
      ...(await runtime.sql.unsafe(
        "SELECT external_id, payload_hash FROM external_stock_mapping WHERE provider = 'jd-auto'",
      )),
    ];
    const hashByCode = new Map(withHashes.map((row) => [row.external_id, row.payload_hash]));
    for (const row of existing) row.sync_hash = hashByCode.get(row.external_code) ?? null;

    const runId = `run-${startedAt.replace(/[̀-ͯ]/g, "").slice(0, 14)}-${PROVIDER}`;
    const idFactory = (seed) => `jda-${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
    const existingByCode = new Map(existing.map((row) => [row.external_code, row]));
    for (const item of accepted) {
      item.vehicleId = existingByCode.get(item.unitId)?.id ?? idFactory(`vehicle:${item.unitId}`);
    }

    const tempDir = mkdtempSync(join(tmpdir(), "jda-stock-sync-"));
    try {
    const { media, failures } = runtime.skipPhotos
      ? { media: [], failures: [] }
      : await preparePhotos(runtime, accepted, tempDir);
    report(
      "Fotos que no se pudieron preparar:",
      failures.map((item) => `${item.unitId}/${item.fileName} — ${item.reason}`),
    );

    const finishedAt = new Date().toISOString();
    const { sql, changed } = buildSyncSql({
      runId,
      accepted: accepted.map((item) => ({ ...item, externalCode: item.unitId })),
      rejected,
      existing,
      media,
      startedAt,
      finishedAt,
      actor,
      idFactory,
    });

    for (const photo of media) {
      await r2Put(runtime, photo.r2Key, photo.file, photo.contentType);
    }
    await runtime.d1.exec(sql);

    console.log(`\nCorrida ${runId}: ${changed} unidades con cambios, ${media.length} fotos publicadas.`);
    return { accepted, rejected, media, changed, written: true };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } finally {
    await runtime.cleanup();
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  runStockSync().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
