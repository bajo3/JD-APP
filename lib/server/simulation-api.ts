import { createSimulationSnapshot } from "@/lib/application/index.mjs";
import {
  assertSimulationReplay,
  SimulationReplayConflict,
} from "@/lib/data/repositories";
import {
  ApiError,
  apiRoute,
  json,
  publicCode,
  readJsonObject,
  requireIdempotencyKey,
  requiredString,
} from "./api";
import {
  applicationDependencies,
  rethrowApplicationError,
} from "./affordability";
import { getDataAccess, sourceMeta, type DataAccess } from "./data-access";
import { simulationDto } from "./dto";

const REQUEST_FIELDS = new Set([
  "vehicleId",
  "vehicleSlug",
  "selectionVersion",
  "simulationInput",
]);
const SIMULATION_INPUT_FIELDS = new Set([
  "cashCents",
  "accreditedDepositCents",
  "maxMonthlyPaymentCents",
  "acceptedTerms",
  "appraisal",
  "preferences",
]);

type MoneyDto = { currency: string; minorUnits: number };
type SimulationInput = Record<string, unknown> & { cashCents: number };
type ApplicationSnapshot = {
  simulationCode: string;
  createdAt: string;
  expiresAt: string;
  engineVersion: string;
  rulesetVersion: string;
  disclaimers: string[];
  request: SimulationInput;
  selectionVersion: string;
  evaluation: {
    status: string;
    certainty: string;
    appliedPromotionIds: string[];
    breakdown: {
      listedPrice: MoneyDto;
      effectivePrice: MoneyDto;
      appraisalApplied: MoneyDto;
      tradeInBonus: MoneyDto;
      principal: MoneyDto;
      operationCost: MoneyDto;
      termMonths: number | null;
      installment: MoneyDto | null;
      totalRepayment: MoneyDto | null;
      planVersion: string | null;
    };
  };
};

type SimulationCommand = {
  vehicleId: string;
  vehicleSlug: string;
  selectionVersion: string;
  simulationInput: Record<string, unknown>;
};

export type SimulationApiRuntime = {
  access?: DataAccess;
  now?: Date;
  idGenerator?: () => string;
  codeGenerator?: () => string;
  dependencies?: Awaited<ReturnType<typeof applicationDependencies>>;
  createSnapshot?: typeof createSimulationSnapshot;
};

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      [unknown]: "Este campo no forma parte del contrato de simulación.",
    });
  }
}

function simulationCommand(payload: Record<string, unknown>): SimulationCommand {
  rejectUnknownFields(payload, REQUEST_FIELDS);
  const vehicleId = requiredString(payload, "vehicleId", { min: 3, max: 80 });
  const vehicleSlug = requiredString(payload, "vehicleSlug", { min: 3, max: 120 });
  const selectionVersion = requiredString(payload, "selectionVersion", {
    min: 64,
    max: 64,
  });
  if (!/^[a-f0-9]{64}$/.test(selectionVersion)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      selectionVersion: "La versión de selección no es válida.",
    });
  }
  const input = payload.simulationInput;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      simulationInput: "Debe ser el input devuelto por la búsqueda vigente.",
    });
  }
  const simulationInput = input as Record<string, unknown>;
  rejectUnknownFields(simulationInput, SIMULATION_INPUT_FIELDS);
  return { vehicleId, vehicleSlug, selectionVersion, simulationInput };
}

function replayEnvelope(
  command: SimulationCommand,
  normalizedInput: Record<string, unknown> = command.simulationInput,
): Record<string, unknown> {
  return {
    vehicleId: command.vehicleId,
    vehicleSlug: command.vehicleSlug,
    selectionVersion: command.selectionVersion,
    simulationInput: normalizedInput,
  };
}

function replayResponse(
  simulation: Parameters<typeof simulationDto>[0],
  access: DataAccess,
): Response {
  return json(
    {
      data: simulationDto(simulation),
      meta: { ...sourceMeta(access.source), idempotencyReplayed: true },
    },
    { status: 200, headers: { "Idempotency-Replayed": "true" } },
  );
}

function assertEarlyReplay(
  existing: Parameters<typeof simulationDto>[0],
  command: SimulationCommand,
): void {
  try {
    assertSimulationReplay(existing, {
      selection: {
        vehicleId: existing.vehicleId,
        appraisalId: existing.appraisalId,
        leadId: existing.leadId,
      },
      canonicalInput: replayEnvelope(command),
    });
  } catch (error) {
    if (error instanceof SimulationReplayConflict) {
      throw new ApiError(409, "OPERATION_CHANGED", error.message);
    }
    throw error;
  }
}

async function confirmedSnapshot(
  command: SimulationCommand,
  simulationCode: string,
  runtime: SimulationApiRuntime,
  access: DataAccess,
  now: Date,
): Promise<ApplicationSnapshot> {
  try {
    const dependencies = runtime.dependencies ?? await applicationDependencies(access, now);
    const createSnapshot = runtime.createSnapshot ?? createSimulationSnapshot;
    return await createSnapshot(
      {
        vehicleId: command.vehicleId,
        vehicleSlug: command.vehicleSlug,
        selectionVersion: command.selectionVersion,
        simulationInput: command.simulationInput,
        simulationCode,
      },
      dependencies,
    ) as ApplicationSnapshot;
  } catch (error) {
    rethrowApplicationError(error);
  }
}

export async function createSimulationResponse(
  request: Request,
  runtime: SimulationApiRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    const idempotencyKey = requireIdempotencyKey(request);
    const command = simulationCommand(await readJsonObject(request));
    const access = runtime.access ?? getDataAccess();
    const existing = await access.simulations.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      assertEarlyReplay(existing, command);
      return replayResponse(existing, access);
    }

    const now = runtime.now ?? new Date();
    const vehicle = await access.stock.findBySlug(command.vehicleSlug);
    if (!vehicle || vehicle.id !== command.vehicleId) {
      throw new ApiError(404, "VEHICLE_NOT_FOUND", "El vehículo no está disponible.");
    }
    if (vehicle.priceValidUntil && Date.parse(vehicle.priceValidUntil) <= now.getTime()) {
      throw new ApiError(
        409,
        "VEHICLE_PRICE_EXPIRED",
        "El precio cambió y debe consultarse nuevamente.",
      );
    }

    const id = runtime.idGenerator?.() ?? crypto.randomUUID();
    const simulationCode = runtime.codeGenerator?.() ?? publicCode("JD");
    const snapshot = await confirmedSnapshot(command, simulationCode, runtime, access, now);
    const breakdown = snapshot.evaluation.breakdown;
    const inputSnapshot = replayEnvelope(command, snapshot.request);
    let simulation;
    try {
      simulation = await access.simulations.create({
        id,
        publicCode: snapshot.simulationCode,
        idempotencyKey,
        leadId: null,
        vehicleId: vehicle.id,
        appraisalId: null,
        promotionId: snapshot.evaluation.appliedPromotionIds[0],
        status: "ACTIVE",
        classification: snapshot.evaluation.status.toUpperCase(),
        certaintyLevel: snapshot.evaluation.certainty,
        vehiclePriceCents: breakdown.listedPrice.minorUnits,
        effectivePriceCents: breakdown.effectivePrice.minorUnits,
        appraisalAppliedCents: breakdown.appraisalApplied.minorUnits,
        tradeInBonusCents: breakdown.tradeInBonus.minorUnits,
        cashCents: snapshot.request.cashCents,
        financePrincipalCents: breakdown.principal.minorUnits,
        termMonths: breakdown.termMonths,
        installmentCents: breakdown.installment?.minorUnits,
        totalCostCents:
          breakdown.totalRepayment?.minorUnits ?? breakdown.operationCost.minorUnits,
        currency: vehicle.currency,
        engineVersion: snapshot.engineVersion,
        ruleVersion: snapshot.rulesetVersion,
        financePlanVersion: breakdown.planVersion,
        inputSnapshotJson: JSON.stringify(inputSnapshot),
        resultSnapshotJson: JSON.stringify(snapshot),
        disclaimerSnapshot: snapshot.disclaimers.join(" "),
        expiresAt: snapshot.expiresAt,
      });
    } catch (error) {
      if (error instanceof SimulationReplayConflict) {
        throw new ApiError(409, "OPERATION_CHANGED", error.message);
      }
      throw error;
    }
    const replayed = simulation.id !== id;
    return json(
      {
        data: simulationDto(simulation),
        meta: { ...sourceMeta(access.source), idempotencyReplayed: replayed },
      },
      {
        status: replayed ? 200 : 201,
        headers: replayed ? { "Idempotency-Replayed": "true" } : undefined,
      },
    );
  });
}
