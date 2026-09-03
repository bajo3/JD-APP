import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: "data:text/javascript,export const env = Object.freeze({});", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const relative = specifier.slice(2);
      return {
        url: pathToFileURL(resolve(
          projectRoot,
          specifier === "@/db"
            ? "db/index.ts"
            : specifier === "@/lib/admin"
              ? "lib/admin/index.ts"
              : relative.endsWith(".mjs") ? relative : `${relative}.ts`,
        )).href,
        shortCircuit: true,
      };
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[cm]?[jt]s$/.test(specifier) &&
      !String(context.parentURL ?? "").includes("/node_modules/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts") && !url.includes("/node_modules/")) {
      return {
        format: "module",
        source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), {
          mode: "transform",
          sourceMap: false,
        }),
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const { D1DemandRepository } = await import("../lib/data/demand-repository.ts");
const { matchVehicleAgainstDemands, buildMatchMessageDraft } = await import(
  "../lib/server/demand-matching-service.ts"
);

const NOW = new Date("2026-09-03T12:00:00.000Z");
const VALID_UNTIL = "2026-10-03T12:00:00.000Z";

function sqliteD1(database) {
  function statement(sql, bindings = []) {
    return {
      bind(...values) { return statement(sql, values); },
      async first() { return database.prepare(sql).get(...bindings) ?? null; },
      async all() {
        return { results: database.prepare(sql).all(...bindings), success: true, meta: {} };
      },
      async run() {
        const result = database.prepare(sql).run(...bindings);
        return { results: [], success: true, meta: { changes: Number(result.changes) } };
      },
    };
  }
  return {
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function amarokCriteria() {
  return {
    makes: ["Volkswagen"],
    models: ["Amarok"],
    minYear: 2015,
    maxPriceCents: 25_000_00,
    currency: "USD",
    maxMileageKm: 150_000,
    tradeIn: true,
    urgencyDays: 30,
  };
}

function harness() {
  const database = new DatabaseSync(":memory:");
  for (const path of [
    "drizzle/0000_chemical_tiger_shark.sql",
    "drizzle/0012_mysterious_forge.sql",
    "drizzle/0013_dizzy_pretty_boy.sql",
  ]) {
    database.exec(readFileSync(resolve(projectRoot, path), "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  database
    .prepare(`INSERT INTO lead (id, name, phone_normalized, source) VALUES ('lead-1', 'Marina', '+5492494587046', 'INBOX_WHATSAPP')`)
    .run();
  database
    .prepare(
      `INSERT INTO vehicle (id, slug, make, model, trim, year, mileage_km, price_cents, currency,
                            body_type, fuel_type, transmission, color, status)
       VALUES ('veh-1', 'amarok-2018', 'Volkswagen', 'Amarok', 'Comfortline', 2018, 120000, 2300000,
               'USD', 'pickup', 'diesel', 'manual', 'blanco', 'PUBLISHED')`,
    )
    .run();

  const repository = new D1DemandRepository(sqliteD1(database));
  return { database, repository, rows: (sql) => database.prepare(sql).all() };
}

async function seedDemand(repository, { confirm = true, criteria = amarokCriteria() } = {}) {
  await repository.createPassport({
    id: "pass-1",
    leadId: "lead-1",
    conversationId: null,
    budgetCents: 25_000_00,
    downPaymentCents: 5_000_00,
    maxMonthlyPaymentCents: null,
    currency: "USD",
    desiredMakes: ["Volkswagen"],
    desiredModels: ["Amarok"],
    acceptedTypes: ["pickup"],
    minYear: 2015,
    maxMileageKm: 150_000,
    primaryUse: "trabajo",
    needsFinancing: true,
    tradeInDescription: "Gol 2012",
    urgencyDays: 30,
    locality: "Tandil",
    maxDistanceKm: 100,
    mandatoryConditions: ["papeles al día"],
    negotiableConditions: ["color"],
    createdAt: NOW.toISOString(),
  });
  if (confirm) {
    await repository.confirmPassport({ passportId: "pass-1", confirmedAt: NOW.toISOString() });
  }
  await repository.createDemand({
    id: "dem-1",
    publicCode: "DEM-000001",
    passportId: "pass-1",
    leadId: "lead-1",
    criteria,
    validUntil: VALID_UNTIL,
    assignedTo: "vendedor@jda.test",
    createdAt: NOW.toISOString(),
  });
}

test("el pasaporte nace en borrador y la demanda espera la confirmación del cliente", async () => {
  const { repository, rows } = harness();
  await seedDemand(repository, { confirm: false });
  assert.equal(rows("SELECT * FROM demand").length, 0, "sin confirmar no hay demanda");

  const [passport] = rows("SELECT * FROM buyer_passport");
  assert.equal(passport.status, "DRAFT");
  assert.equal(passport.confirmed_at, null);
  assert.deepEqual(JSON.parse(passport.mandatory_conditions_json), ["papeles al día"]);

  assert.equal(await repository.confirmPassport({ passportId: "pass-1", confirmedAt: NOW.toISOString() }), true);
  assert.equal(
    await repository.confirmPassport({ passportId: "pass-1", confirmedAt: NOW.toISOString() }),
    false,
    "confirmar dos veces no vuelve a contar",
  );
});

test("una demanda vigente aparece; una vencida no", async () => {
  const { repository } = harness();
  await seedDemand(repository);
  assert.equal((await repository.listOpenDemands(NOW.toISOString())).length, 1);
  assert.equal((await repository.listOpenDemands("2026-11-01T00:00:00.000Z")).length, 0);
});

test("una unidad nueva guarda sus coincidencias sin avisarle a nadie", async () => {
  const { repository, rows } = harness();
  await seedDemand(repository);
  let counter = 0;
  const views = await matchVehicleAgainstDemands(
    {
      id: "veh-1",
      make: "Volkswagen",
      model: "Amarok",
      year: 2018,
      priceCents: 23_000_00,
      currency: "USD",
      mileageKm: 120_000,
    },
    { repository, now: NOW, newId: () => `m-${(counter += 1)}` },
  );

  assert.equal(views.length, 1);
  assert.equal(views[0].scorePercent, 100);
  assert.equal(views[0].assignedTo, "vendedor@jda.test", "se sabe a qué vendedor avisar");
  assert.ok(views[0].breakdown.length > 0, "el porcentaje viaja con su explicación");

  const [match] = rows("SELECT * FROM demand_match");
  assert.equal(match.status, "NEW", "nace sin avisar: el aviso lo aprueba una persona");
  assert.equal(match.notified_to, null);
  assert.equal(match.score_bps, 10000);
  assert.ok(JSON.parse(match.breakdown_json).criterios.length > 0);
});

test("volver a evaluar la misma unidad actualiza la coincidencia en lugar de duplicarla", async () => {
  const { repository, rows } = harness();
  await seedDemand(repository);
  const vehicle = {
    id: "veh-1",
    make: "Volkswagen",
    model: "Amarok",
    year: 2018,
    priceCents: 23_000_00,
    currency: "USD",
    mileageKm: 120_000,
  };
  let counter = 0;
  const runtime = { repository, now: NOW, newId: () => `m-${(counter += 1)}` };
  await matchVehicleAgainstDemands(vehicle, runtime);
  await matchVehicleAgainstDemands({ ...vehicle, mileageKm: 260_000 }, runtime);

  const matches = rows("SELECT * FROM demand_match");
  assert.equal(matches.length, 1);
  assert.ok(matches[0].score_bps < 10000, "el puntaje se actualiza con el dato nuevo");
  assert.equal(matches[0].version, 2);
});

test("una unidad fuera del presupuesto no genera coincidencia", async () => {
  const { repository, rows } = harness();
  await seedDemand(repository);
  const views = await matchVehicleAgainstDemands(
    {
      id: "veh-1",
      make: "Volkswagen",
      model: "Amarok",
      year: 2018,
      priceCents: 40_000_00,
      currency: "USD",
      mileageKm: 100_000,
    },
    { repository, now: NOW, newId: () => "m-1" },
  );
  assert.equal(views.length, 0);
  assert.equal(rows("SELECT * FROM demand_match").length, 0);
});

test("el recorrido de la coincidencia queda sellado paso a paso", async () => {
  const { repository, rows } = harness();
  await seedDemand(repository);
  await matchVehicleAgainstDemands(
    {
      id: "veh-1",
      make: "Volkswagen",
      model: "Amarok",
      year: 2018,
      priceCents: 23_000_00,
      currency: "USD",
      mileageKm: 120_000,
    },
    { repository, now: NOW, newId: () => "m-1" },
  );

  await repository.markMatch({
    matchId: "m-1",
    status: "NOTIFIED",
    actor: "vendedor@jda.test",
    occurredAt: "2026-09-03T13:00:00.000Z",
  });
  await repository.markMatch({
    matchId: "m-1",
    status: "RESPONDED",
    actor: null,
    occurredAt: "2026-09-03T14:00:00.000Z",
  });
  await repository.markMatch({
    matchId: "m-1",
    status: "VISITED",
    actor: null,
    occurredAt: "2026-09-04T10:00:00.000Z",
  });
  await repository.markMatch({
    matchId: "m-1",
    status: "PURCHASED",
    actor: null,
    occurredAt: "2026-09-05T10:00:00.000Z",
  });

  const [match] = rows("SELECT * FROM demand_match");
  assert.equal(match.status, "PURCHASED");
  assert.equal(match.notified_to, "vendedor@jda.test");
  assert.equal(match.notified_at, "2026-09-03T13:00:00.000Z");
  assert.equal(match.responded_at, "2026-09-03T14:00:00.000Z");
  assert.equal(match.visited_at, "2026-09-04T10:00:00.000Z");
  assert.equal(match.purchased_at, "2026-09-05T10:00:00.000Z");
});

test("descartar una coincidencia exige decir por qué", async () => {
  const { repository, rows } = harness();
  await seedDemand(repository);
  await matchVehicleAgainstDemands(
    {
      id: "veh-1",
      make: "Volkswagen",
      model: "Amarok",
      year: 2018,
      priceCents: 23_000_00,
      currency: "USD",
      mileageKm: 120_000,
    },
    { repository, now: NOW, newId: () => "m-1" },
  );
  await repository.markMatch({
    matchId: "m-1",
    status: "DISCARDED",
    actor: "vendedor@jda.test",
    occurredAt: NOW.toISOString(),
    reason: "ya compró en otro lado",
  });
  const [match] = rows("SELECT * FROM demand_match");
  assert.equal(match.status, "DISCARDED");
  assert.equal(match.discarded_reason, "ya compró en otro lado");
  assert.equal(match.purchased_at, null);
});

test("el mensaje preparado no promete ni inventa cifras", () => {
  const draft = buildMatchMessageDraft({
    vehicle: {
      id: "veh-1",
      make: "Volkswagen",
      model: "Amarok",
      year: 2018,
      priceCents: 23_000_00,
      currency: "USD",
      mileageKm: 120_000,
    },
    demandCode: "DEM-000001",
  });
  assert.match(draft, /Volkswagen Amarok 2018/);
  // La única cifra del borrador es el año de la unidad: ni precio, ni cuota,
  // ni kilómetros. Los números los pone el vendedor con una simulación.
  assert.deepEqual(draft.match(/\d+/g), ["2018"]);
  assert.doesNotMatch(draft, /\$|USD|cuota/i);
  assert.doesNotMatch(draft, /reserv|te la guardo|descuento|bonific/i);
});

test("una demanda con criterios corruptos se saltea sin romper el resto", async () => {
  const { repository } = harness();
  await seedDemand(repository, { criteria: { makes: "no es una lista" } });
  const views = await matchVehicleAgainstDemands(
    {
      id: "veh-1",
      make: "Volkswagen",
      model: "Amarok",
      year: 2018,
      priceCents: 23_000_00,
      currency: "USD",
      mileageKm: 120_000,
    },
    { repository, now: NOW, newId: () => "m-1" },
  );
  assert.equal(views.length, 0);
});
