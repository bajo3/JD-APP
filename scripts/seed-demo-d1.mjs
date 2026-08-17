import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const DEMO_DISCLAIMER =
  "TARIFARIO DEMO: valores ficticios para previsualización. No constituye una oferta, aprobación ni condición comercial real.";

function literal(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("Seed numbers must be safe integers");
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insert(table, columns, rows, updateColumns = []) {
  const values = rows
    .map((row) => `(${columns.map((column) => literal(row[column])).join(", ")})`)
    .join(",\n  ");
  const conflict =
    updateColumns.length === 0
      ? "ON CONFLICT(id) DO NOTHING"
      : `ON CONFLICT(id) DO UPDATE SET ${updateColumns
          .map((column) => `${column} = excluded.${column}`)
          .join(", ")}`;
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES\n  ${values}\n${conflict};`;
}

export function buildDemoSeedSql(now = new Date()) {
  if (Number.isNaN(now.getTime())) throw new TypeError("A valid seed date is required");
  const instant = now.toISOString();
  const validFrom = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const offerEndsAt = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
  const planEndsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const vehicles = [
    {
      id: "veh-tcross-2022",
      slug: "volkswagen-t-cross-comfortline-2022",
      external_code: "DEMO-001",
      make: "Volkswagen",
      model: "T-Cross",
      trim: "Comfortline",
      year: 2022,
      mileage_km: 46500,
      price_cents: 3280000000,
      body_type: "SUV",
      fuel_type: "Nafta",
      transmission: "Automática",
      color: "Gris",
    },
    {
      id: "veh-cronos-2023",
      slug: "fiat-cronos-drive-2023",
      external_code: "DEMO-002",
      make: "Fiat",
      model: "Cronos",
      trim: "Drive 1.3",
      year: 2023,
      mileage_km: 28100,
      price_cents: 2490000000,
      body_type: "Sedán",
      fuel_type: "Nafta",
      transmission: "Manual",
      color: "Blanco",
    },
    {
      id: "veh-tracker-2021",
      slug: "chevrolet-tracker-ltz-2021",
      external_code: "DEMO-003",
      make: "Chevrolet",
      model: "Tracker",
      trim: "LTZ",
      year: 2021,
      mileage_km: 52900,
      price_cents: 2970000000,
      body_type: "SUV",
      fuel_type: "Nafta",
      transmission: "Automática",
      color: "Azul",
    },
  ].map((vehicle) => ({
    ...vehicle,
    currency: "ARS",
    status: "AVAILABLE",
    source: "DEMO_SEED",
    last_synced_at: instant,
    published_at: instant,
    updated_at: instant,
  }));

  const statements = [
    "PRAGMA foreign_keys=ON;",
    insert(
      "business_profile",
      [
        "id",
        "name",
        "city",
        "address",
        "phone_national",
        "whatsapp_e164",
        "timezone",
        "currency",
        "locale",
        "stock_freshness_minutes",
      ],
      [
        {
          id: "business-jda",
          name: "Jesús Díaz Automotores",
          city: "Tandil",
          address: "Piedrabuena esq. Rauch",
          phone_national: "2494587046",
          whatsapp_e164: null,
          timezone: "America/Argentina/Buenos_Aires",
          currency: "ARS",
          locale: "es-AR",
          stock_freshness_minutes: 1440,
        },
      ],
    ),
    insert(
      "vehicle",
      [
        "id",
        "slug",
        "external_code",
        "make",
        "model",
        "trim",
        "year",
        "mileage_km",
        "price_cents",
        "currency",
        "body_type",
        "fuel_type",
        "transmission",
        "color",
        "status",
        "source",
        "last_synced_at",
        "published_at",
        "updated_at",
      ],
      vehicles,
      [
        "price_cents",
        "status",
        "last_synced_at",
        "published_at",
        "updated_at",
      ],
    ),
    insert(
      "vehicle_price_history",
      ["id", "vehicle_id", "price_cents", "currency", "valid_from", "changed_by", "change_reason"],
      vehicles.map((vehicle) => ({
        id: `price-${vehicle.id}-demo`,
        vehicle_id: vehicle.id,
        price_cents: vehicle.price_cents,
        currency: "ARS",
        valid_from: instant,
        changed_by: "DEMO_SEED",
        change_reason: "DEMO_INITIAL_PRICE",
      })),
    ),
    insert(
      "finance_plan_version",
      [
        "id",
        "version",
        "name",
        "provider",
        "status",
        "currency",
        "pricing_kind",
        "monthly_rate_bps",
        "max_finance_ratio_bps",
        "minimum_down_payment_ratio_bps",
        "allowed_vehicle_types_json",
        "max_vehicle_age_years",
        "comfortable_payment_margin_bps",
        "is_demo",
        "disclaimer",
        "valid_from",
        "valid_until",
        "published_at",
        "updated_at",
      ],
      [
        {
          id: "finance-plan-demo-preview",
          version: "DEMO-PREVIEW-V1",
          name: "DEMO — Plan ilustrativo de previsualización",
          provider: "DEMO_NO_COMERCIAL",
          status: "PUBLISHED",
          currency: "ARS",
          pricing_kind: "french",
          monthly_rate_bps: 250,
          max_finance_ratio_bps: 7000,
          minimum_down_payment_ratio_bps: 2500,
          allowed_vehicle_types_json: JSON.stringify(["car", "suv", "pickup"]),
          max_vehicle_age_years: 10,
          comfortable_payment_margin_bps: 1000,
          is_demo: 1,
          disclaimer: DEMO_DISCLAIMER,
          valid_from: validFrom,
          valid_until: planEndsAt,
          published_at: instant,
          updated_at: instant,
        },
      ],
      ["valid_from", "valid_until", "published_at", "updated_at"],
    ),
    insert(
      "finance_plan_tier",
      [
        "id",
        "finance_plan_version_id",
        "term_months",
        "min_amount_cents",
        "max_amount_cents",
        "sort_order",
      ],
      [12, 18, 24].map((term, index) => ({
        id: `finance-plan-demo-tier-${term}`,
        finance_plan_version_id: "finance-plan-demo-preview",
        term_months: term,
        min_amount_cents: 300000000,
        max_amount_cents: 2200000000,
        sort_order: index,
      })),
    ),
    insert(
      "promotion",
      [
        "id",
        "slug",
        "public_code",
        "title",
        "description",
        "type",
        "status",
        "discount_cents",
        "trade_in_bonus_cents",
        "stackable",
        "normal_conditions_snapshot_json",
        "starts_at",
        "ends_at",
        "published_at",
        "updated_at",
      ],
      [
        {
          id: "promo-demo-dia",
          slug: "oferta-demo-del-dia",
          public_code: "JD-DEMO",
          title: "DEMO — Oferta JD de previsualización",
          description: "Ejemplo ficticio para validar la experiencia. No constituye una oferta comercial real.",
          type: "PRICE_DISCOUNT",
          status: "ACTIVE",
          discount_cents: 100000000,
          trade_in_bonus_cents: 0,
          stackable: 0,
          normal_conditions_snapshot_json: JSON.stringify({
            vehicleId: "veh-tcross-2022",
            normalPriceCents: 3280000000,
            demo: true,
          }),
          starts_at: validFrom,
          ends_at: offerEndsAt,
          published_at: instant,
          updated_at: instant,
        },
      ],
      ["starts_at", "ends_at", "published_at", "updated_at"],
    ),
    "INSERT INTO promotion_vehicle (promotion_id, vehicle_id, is_primary) VALUES ('promo-demo-dia', 'veh-tcross-2022', 1) ON CONFLICT(promotion_id, vehicle_id) DO UPDATE SET is_primary = excluded.is_primary;",
    "PRAGMA optimize;",
  ];
  return `${statements.join("\n\n")}\n`;
}

function parseArgs(argv) {
  const remote = argv.includes("--remote");
  if (remote && !argv.includes("--confirm-demo")) {
    throw new Error("Remote demo seed requires the explicit --confirm-demo flag.");
  }
  const databaseIndex = argv.indexOf("--database");
  const database = databaseIndex >= 0 ? argv[databaseIndex + 1] : "DB";
  if (!database || !/^[A-Za-z0-9_-]+$/.test(database)) {
    throw new Error("Invalid D1 database name.");
  }
  return { database, dryRun: argv.includes("--dry-run"), remote };
}

export function resolveSeedRuntime(argv = [], projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..")) {
  const options = parseArgs(argv);
  const configPath = join(projectRoot, "dist", "server", "wrangler.json");
  const serverEntry = join(projectRoot, "dist", "server", "index.js");
  if (!existsSync(configPath) || !existsSync(serverEntry)) {
    throw new Error(
      "Built Wrangler config not found. Run `npm run build` before seeding D1.",
    );
  }
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new Error("Built Wrangler config is not valid JSON. Run `npm run build` again.");
  }
  const bindings = Array.isArray(config.d1_databases) ? config.d1_databases : [];
  if (!bindings.some((binding) => binding?.binding === options.database)) {
    throw new Error(
      `D1 binding ${options.database} is missing from dist/server/wrangler.json.`,
    );
  }
  return {
    ...options,
    configPath,
    persistPath: join(projectRoot, ".wrangler", "state"),
    projectRoot,
  };
}

export function runDemoSeed(argv = process.argv.slice(2)) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const runtime = resolveSeedRuntime(argv, join(scriptDir, ".."));
  const sql = buildDemoSeedSql();
  if (runtime.dryRun) {
    process.stdout.write(sql);
    return;
  }

  const wrangler = join(
    scriptDir,
    "..",
    "node_modules",
    "wrangler",
    "bin",
    "wrangler.js",
  );
  if (!existsSync(wrangler)) {
    throw new Error("Local Wrangler executable not found. Run npm install first.");
  }

  const tempDir = mkdtempSync(join(tmpdir(), "jda-demo-seed-"));
  const sqlFile = join(tempDir, "seed.sql");
  try {
    writeFileSync(sqlFile, sql, { encoding: "utf8", flag: "wx" });
    const target = runtime.remote ? "--remote" : "--local";
    const args = [
      "d1",
      "execute",
      runtime.database,
      target,
      "--config",
      runtime.configPath,
      "--yes",
      "--file",
      sqlFile,
    ];
    if (!runtime.remote) args.push("--persist-to", runtime.persistPath);
    const result = spawnSync(
      process.execPath,
      [wrangler, ...args],
      { cwd: runtime.projectRoot, encoding: "utf8", stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) runDemoSeed();
