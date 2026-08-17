import {
  evaluateInventory,
  fixtureRuleset,
  fixtureSnapshots,
} from "../domain/index.mjs";
import {
  APPLICATION_SCHEMA_VERSION,
  ApplicationContractError,
  OPERATION_DISCLAIMERS,
  explainReasons,
  explainStatus,
  immutableJsonDto,
} from "./contracts.mjs";
import {
  normalizePlanRecord,
  normalizePromotionRecord,
  normalizeSearchRequest,
  normalizeVehicleRecord,
} from "./normalizers.mjs";

const DEFAULT_STOCK_FRESHNESS_MINUTES = 24 * 60;

export async function searchAffordability(request, dependencies = {}) {
  const clock = dependencies.clock ?? (() => new Date());
  const input = normalizeSearchRequest(request, clock);
  const loaded = await loadApplicationRecords(dependencies, input.at);
  const stockFreshnessMinutes =
    dependencies.stockFreshnessMinutes ?? DEFAULT_STOCK_FRESHNESS_MINUTES;
  const vehicles = loaded.vehicles.map((record) =>
    normalizeVehicleRecord(record, {
      evaluatedAt: input.at,
      stockFreshnessMinutes,
    }),
  );
  const plans = loaded.plans.map(normalizePlanRecord);
  const demoPlanDisclaimers = loaded.plans
    .filter((plan) => plan.isDemo === true && typeof plan.disclaimer === "string")
    .map((plan) => plan.disclaimer);
  const promotions = loaded.promotions.map(normalizePromotionRecord);
  const ruleset = Object.freeze({
    version: loaded.rulesetVersion,
    comfortablePaymentMarginBps:
      loaded.comfortablePaymentMarginBps ?? 1_000,
    plans: Object.freeze(plans),
  });
  const snapshots = vehicles.map((vehicle) =>
    Object.freeze({ vehicle, promotions: Object.freeze(promotions) }),
  );
  const ranked = evaluateInventory(input, ruleset, snapshots);
  return immutableJsonDto({
    schemaVersion: `${APPLICATION_SCHEMA_VERSION}.affordability`,
    evaluatedAt: input.at,
    currency: "ARS",
    rulesetVersion: ruleset.version,
    disclaimers: [...OPERATION_DISCLAIMERS, ...new Set(demoPlanDisclaimers)],
    demo: loaded.plans.some((plan) => plan.isDemo === true),
    criteria: input,
    results: ranked.map(({ snapshot, evaluation, rankSignals }, index) => ({
      rank: index + 1,
      vehicle: {
        id: snapshot.vehicle.id,
        slug: snapshot.vehicle.slug,
        brand: snapshot.vehicle.brand,
        model: snapshot.vehicle.model,
        year: snapshot.vehicle.year,
        type: snapshot.vehicle.type,
        available: snapshot.vehicle.available,
        updatedAt: snapshot.vehicle.updatedAt,
      },
      status: evaluation.status,
      statusLabel: explainStatus(evaluation.status),
      reasonDetails: explainReasons(evaluation.reasons),
      evaluation,
      rankSignals,
    })),
  });
}

export async function createSimulationSnapshot(request, dependencies = {}) {
  if (typeof request?.vehicleId !== "string" || request.vehicleId.trim() === "") {
    throw new ApplicationContractError(
      "missing_vehicle_id",
      "Debe seleccionarse un vehículo para crear la simulación.",
      "vehicleId",
    );
  }
  const simulationCode = normalizeSimulationCode(
    request.simulationCode ?? dependencies.codeGenerator?.(),
  );
  const search = await searchAffordability(request, dependencies);
  const selected = search.results.find(
    ({ vehicle }) => vehicle.id === request.vehicleId,
  );
  if (!selected) {
    throw new ApplicationContractError(
      "vehicle_not_found",
      "El vehículo seleccionado no existe en el stock consultado.",
      "vehicleId",
      { vehicleId: request.vehicleId },
    );
  }
  const snapshot = immutableJsonDto({
    schemaVersion: `${APPLICATION_SCHEMA_VERSION}.simulation`,
    simulationCode,
    createdAt: search.evaluatedAt,
    expiresAt: selected.evaluation.validUntil,
    currency: "ARS",
    engineVersion: selected.evaluation.engineVersion,
    rulesetVersion: selected.evaluation.rulesetVersion,
    demo: search.demo,
    disclaimers: search.disclaimers,
    request: search.criteria,
    vehicle: selected.vehicle,
    evaluation: selected.evaluation,
    reasonDetails: selected.reasonDetails,
  });

  if (dependencies.simulationRepository?.save) {
    await dependencies.simulationRepository.save(snapshot);
  }
  return snapshot;
}

export function createFixtureApplicationRecords() {
  return Object.freeze({
    vehicles: Object.freeze(fixtureSnapshots.map(({ vehicle }) => vehicle)),
    plans: fixtureRuleset.plans,
    promotions: Object.freeze(
      fixtureSnapshots.flatMap(({ promotions }) => promotions),
    ),
    rulesetVersion: fixtureRuleset.version,
    comfortablePaymentMarginBps: fixtureRuleset.comfortablePaymentMarginBps,
  });
}

async function loadApplicationRecords(dependencies, evaluatedAt) {
  if (dependencies.records) return normalizeRecordContainer(dependencies.records);
  const repositories = dependencies.repositories;
  if (!repositories) {
    throw new ApplicationContractError(
      "missing_data_source",
      "Debe inyectarse records o repositories.",
      "dependencies",
    );
  }
  const [vehicles, plans, promotions] = await Promise.all([
    loadVehicleRepository(repositories),
    loadPlanRepository(repositories, evaluatedAt),
    loadPromotionRepository(repositories, evaluatedAt),
  ]);
  return {
    vehicles,
    plans,
    promotions,
    rulesetVersion: repositories.rulesetVersion ?? "rules-unversioned",
    comfortablePaymentMarginBps:
      repositories.comfortablePaymentMarginBps ?? 1_000,
  };
}

function normalizeRecordContainer(records) {
  const snapshots = records.snapshots ?? [];
  return {
    vehicles: records.vehicles ?? snapshots.map(({ vehicle }) => vehicle),
    plans: records.plans ?? records.ruleset?.plans ?? [],
    promotions:
      records.promotions ?? snapshots.flatMap(({ promotions = [] }) => promotions),
    rulesetVersion:
      records.rulesetVersion ?? records.ruleset?.version ?? "rules-unversioned",
    comfortablePaymentMarginBps:
      records.comfortablePaymentMarginBps ??
      records.ruleset?.comfortablePaymentMarginBps ??
      1_000,
  };
}

async function loadVehicleRepository(repositories) {
  if (repositories.stock?.listAvailable) return repositories.stock.listAvailable();
  if (repositories.vehicles?.list) return repositories.vehicles.list();
  throw missingRepository("stock");
}

async function loadPlanRepository(repositories, evaluatedAt) {
  if (repositories.financingPlans?.listCurrent) {
    return repositories.financingPlans.listCurrent(new Date(evaluatedAt));
  }
  if (repositories.plans?.list) return repositories.plans.list();
  throw missingRepository("financingPlans");
}

async function loadPromotionRepository(repositories, evaluatedAt) {
  if (repositories.promotions?.listCurrent) {
    return repositories.promotions.listCurrent(new Date(evaluatedAt));
  }
  if (repositories.promotions?.findCurrent) {
    const current = await repositories.promotions.findCurrent(new Date(evaluatedAt));
    return current ? [current] : [];
  }
  if (repositories.promotions?.list) return repositories.promotions.list();
  return [];
}

function missingRepository(name) {
  return new ApplicationContractError(
    "missing_repository",
    `Falta el repositorio ${name}.`,
    `repositories.${name}`,
  );
}

function normalizeSimulationCode(value) {
  if (typeof value !== "string" || !/^[A-Z0-9-]{4,32}$/.test(value)) {
    throw new ApplicationContractError(
      "invalid_simulation_code",
      "El código de simulación debe tener entre 4 y 32 caracteres A-Z, 0-9 o guion.",
      "simulationCode",
    );
  }
  return value;
}
