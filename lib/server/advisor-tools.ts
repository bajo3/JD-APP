import { searchAffordability } from "@/lib/application/index.mjs";
import { applicationDependencies, rethrowApplicationError } from "./affordability";
import { getDataAccess, type DataAccess } from "./data-access";
import { ApiError, publicCode, stableToken } from "./api";
import { D1ChannelInboxRepository } from "@/lib/data/channel-inbox-repository";
import { D1DemandRepository, type DemandRepositoryLike } from "@/lib/data/demand-repository";
import { D1VisitRequestRepository, type VisitRequestRepositoryLike } from "@/lib/data/visit-request-repository";
import { D1AppraisalRulesetRepository, type AppraisalRulesetRepositoryLike } from "@/lib/data/appraisal-ruleset-repository";
import { normalizeDemandCriteria } from "@/lib/domain/demand-matching.mjs";
import { estimateAppraisalRange } from "@/lib/domain/appraisal-range.mjs";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/index.mjs";
import { escalateToHuman, type OutboundRuntime } from "./inbox-outbound";
import { createSimulationResponse } from "./simulation-api";

/**
 * Tope de recomendaciones. El pedido dice "hasta tres" y el tope se hace
 * cumplir acá, no en el prompt: el modelo no puede listar una cuarta unidad
 * porque nunca la recibe.
 */
export const MAX_RECOMMENDATIONS = 3;

/**
 * Memoria mínima entre herramientas: qué devolvió la última búsqueda. Existe
 * para que simular sólo pueda apuntar a una unidad que el motor acaba de
 * ofrecer, con los importes que el motor normalizó — no con los que el modelo
 * quiera repetir.
 */
export type AdvisorSession = {
  lastSearch: {
    simulationInput: unknown;
    options: Map<string, { vehicleId: string; vehicleSlug: string; selectionVersion: string }>;
  } | null;
  /** Demanda propuesta al cliente, a la espera de que la confirme o la corrija. */
  pendingDemand: {
    passportId: string;
    leadId: string;
    criteria: unknown;
    validUntil: string;
    resumen: string;
  } | null;
};

export function createAdvisorSession(): AdvisorSession {
  return { lastSearch: null, pendingDemand: null };
}

export type AdvisorToolContext = Readonly<{
  conversationId: string;
  session: AdvisorSession;
  access?: DataAccess;
  now?: Date;
  outboundRuntime?: OutboundRuntime;
  demandRepository?: DemandRepositoryLike;
  visitRepository?: VisitRequestRepositoryLike;
  appraisalRulesetRepository?: AppraisalRulesetRepositoryLike;
  idempotencyKey?: string;
}>;

export type AdvisorToolResult =
  | Readonly<{ ok: true; data: Record<string, unknown> }>
  | Readonly<{ ok: false; code: string; message: string }>;

/**
 * Definiciones que se le pasan al modelo. `strict` y `additionalProperties:
 * false` no son decoración: obligan a que los argumentos validen contra el
 * esquema, así que el asesor no puede colar un campo inventado.
 */
export const ADVISOR_TOOLS = Object.freeze([
  {
    name: "buscar_vehiculos",
    description:
      "Busca en el stock real las unidades que el cliente puede pagar. Devuelve como máximo tres. " +
      "Es la única fuente de unidades: nunca menciones un vehículo que no venga en esta respuesta.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["presupuestoTotal", "anticipo", "cuotaMaxima"],
      properties: {
        presupuestoTotal: {
          type: "number",
          description: "Plata disponible sin financiar, en pesos.",
        },
        anticipo: {
          type: "number",
          description: "Anticipo acreditable, en pesos. Puede ser 0.",
        },
        cuotaMaxima: {
          type: "number",
          description:
            "Cuota mensual máxima que puede pagar el cliente, en pesos. El motor no evalúa sin este dato: " +
            "preguntáselo antes de buscar.",
        },
        plazos: {
          type: "array",
          items: { type: "integer" },
          description: "Plazos en meses que acepta el cliente. Vacío = todos.",
        },
        marcas: {
          type: "array",
          items: { type: "string" },
          description: "Marcas preferidas, si las mencionó.",
        },
        tipos: {
          type: "array",
          items: { type: "string" },
          description: "Tipos de vehículo preferidos (auto, suv, pickup).",
        },
      },
    },
  },
  {
    name: "simular_operacion",
    description:
      "Congela una operación sobre una unidad que devolvió buscar_vehiculos y responde con su código " +
      "público y sus importes. Es la única fuente de cuotas y precios: no calcules ni estimes ninguna " +
      "cifra por tu cuenta. Los importes salen de la búsqueda, no se vuelven a pasar acá.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["vehicleId", "vehicleSlug", "selectionVersion"],
      properties: {
        vehicleId: { type: "string" },
        vehicleSlug: { type: "string" },
        selectionVersion: {
          type: "string",
          description: "El selectionVersion que devolvió buscar_vehiculos para esa unidad.",
        },
      },
    },
  },
  {
    name: "registrar_demanda",
    description:
      "Cuando no hay ninguna unidad que le sirva, guarda lo que el cliente busca como demanda. " +
      "Devuelve un resumen que TENES que leerle al cliente para que lo confirme o lo corrija. " +
      "No queda registrada hasta que la confirme con confirmar_demanda.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["presupuestoMaximo", "moneda"],
      properties: {
        presupuestoMaximo: {
          type: "number",
          description: "Tope que puede pagar, en la moneda indicada.",
        },
        moneda: { type: "string", description: "ARS o USD, tal como lo dijo el cliente." },
        marcas: { type: "array", items: { type: "string" } },
        modelos: { type: "array", items: { type: "string" } },
        tipos: { type: "array", items: { type: "string" }, description: "auto, suv, pickup." },
        anioMinimo: { type: ["integer", "null"] },
        kilometrajeMaximo: { type: ["integer", "null"] },
        entregaUsado: { type: "boolean" },
        descripcionUsado: { type: ["string", "null"] },
        diasParaComprar: { type: ["integer", "null"] },
        localidad: { type: ["string", "null"] },
      },
    },
  },
  {
    name: "confirmar_demanda",
    description:
      "Registra la demanda que el cliente acaba de confirmar, con el resumen que le leiste. " +
      "Usalo solo despues de que el cliente diga que los datos estan bien.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["passportId"],
      properties: {
        passportId: { type: "string", description: "El que devolvio registrar_demanda." },
      },
    },
  },
  {
    name: "registrar_permuta",
    description:
      "Registra los datos declarados del usado para revisión humana. No cotiza, no devuelve rangos " +
      "ni promete toma: una persona revisa físicamente y la documentación antes de decidir.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["marca", "modelo", "anio", "kilometraje", "estadoDeclarado"],
      properties: {
        marca: { type: "string" },
        modelo: { type: "string" },
        version: { type: ["string", "null"] },
        anio: { type: "integer" },
        kilometraje: { type: "integer" },
        estadoDeclarado: { type: "string", description: "EXCELLENT, GOOD, FAIR o NEEDS_REPAIR." },
        estadoDocumentacion: { type: ["string", "null"] },
        tienePrenda: { type: "boolean" },
        observaciones: { type: ["string", "null"] },
      },
    },
  },
  {
    name: "cotizar_permuta",
    description: "Da un rango preliminar sólo desde el tarifario vigente. Nunca confirma una toma: queda sujeto a revisión física y documental.",
    strict: true,
    input_schema: { type: "object", additionalProperties: false, required: ["marca", "modelo", "anio", "kilometraje", "estadoDeclarado"], properties: {
      marca: { type: "string" }, modelo: { type: "string" }, anio: { type: "integer" }, kilometraje: { type: "integer" },
      estadoDeclarado: { type: "string", description: "EXCELLENT, GOOD, FAIR o NEEDS_REPAIR." }, tienePrenda: { type: "boolean" },
    } },
  },
  {
    name: "solicitar_visita",
    description:
      "Registra una solicitud de visita para que una persona confirme disponibilidad y horario. " +
      "No agenda ni reserva: pedí una fecha y hora ISO 8601 con zona horaria. Si menciona una unidad, " +
      "usá sólo un vehicleId que haya devuelto buscar_vehiculos.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["fechaHoraSolicitada"],
      properties: {
        fechaHoraSolicitada: { type: "string", description: "ISO 8601 con zona horaria." },
        vehicleId: { type: ["string", "null"] },
        nota: { type: ["string", "null"] },
      },
    },
  },
  {
    name: "escalar_a_persona",
    description:
      "Pasa la conversación a un vendedor con el hilo completo. Usalo cuando el cliente quiera reservar, " +
      "cerrar, pedir una excepción comercial, hablar con alguien, o cuando no puedas responder con datos verificados.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["motivo"],
      properties: {
        motivo: {
          type: "string",
          description: "Motivo corto y concreto de la escalada.",
        },
      },
    },
  },
]);

function money(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const minor = (value as Record<string, unknown>).minorUnits;
  const numeric = typeof minor === "number" ? minor : Number(minor);
  return Number.isFinite(numeric) ? Math.round(numeric) / 100 : null;
}

/**
 * Plazos a evaluar: los que pidió el cliente o, si no dijo ninguno, todos los
 * que el tarifario vigente permite.
 */
function requestedTerms(
  input: Record<string, unknown>,
  dependencies: { records: { plans: readonly unknown[] } },
): number[] {
  const requested = Array.isArray(input.plazos)
    ? input.plazos.filter((term): term is number => Number.isInteger(term) && term > 0)
    : [];
  if (requested.length > 0) return requested;
  const offered = new Set<number>();
  for (const plan of dependencies.records.plans) {
    const record = (plan ?? {}) as Record<string, unknown>;
    const raw = record.allowedTerms ?? record.allowedTermsJson;
    const list =
      typeof raw === "string"
        ? (() => {
            try {
              return JSON.parse(raw);
            } catch {
              return [];
            }
          })()
        : raw;
    if (Array.isArray(list)) {
      for (const term of list) {
        if (Number.isInteger(term) && term > 0) offered.add(term as number);
      }
    }
  }
  return [...offered].sort((left, right) => left - right);
}

function cents(pesos: number): number {
  return Math.round(pesos * 100);
}

function positiveNumber(input: Record<string, unknown>, key: string, fallback = 0): number {
  const raw = input[key];
  const numeric = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return numeric;
}

function stringList(input: Record<string, unknown>, key: string): string[] {
  const raw = input[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string").slice(0, 10);
}

function optionalText(input: Record<string, unknown>, key: string, max: number): string | null {
  const raw = input[key];
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.");
  const normalized = raw.trim();
  if (!normalized || normalized.length > max) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.");
  }
  return normalized;
}

function requiredText(input: Record<string, unknown>, key: string, min: number, max: number): string {
  const value = optionalText(input, key, max);
  if (!value || value.length < min) throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.");
  return value;
}

function requiredIntegerValue(
  input: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number {
  const value = input[key];
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.");
  }
  return value as number;
}

async function advisorStableId(prefix: string, seed: unknown): Promise<string> {
  return `${prefix}-${await stableToken(JSON.stringify(seed), 32)}`;
}

function reviewUrl(token: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  const path = `/mi-busqueda/${token}`;
  return configured && /^https:\/\//i.test(configured) ? `${configured}${path}` : path;
}

function failure(error: unknown): AdvisorToolResult {
  if (error instanceof ApiError) {
    return { ok: false, code: error.code, message: error.message };
  }
  console.error("advisor_tool_unhandled_error", {
    name: error instanceof Error ? error.name : "UnknownError",
  });
  return {
    ok: false,
    code: "TOOL_FAILED",
    message: "La herramienta falló. Pasá la conversación a una persona.",
  };
}

async function buscarVehiculos(
  input: Record<string, unknown>,
  context: AdvisorToolContext,
): Promise<AdvisorToolResult> {
  const now = context.now ?? new Date();
  const access = context.access ?? getDataAccess();
  const dependencies = await applicationDependencies(access, now);
  let result: Record<string, unknown>;
  try {
    result = (await searchAffordability(
      {
        evaluatedAt: now.toISOString(),
        // El motor exige importes exactos: se mandan en centavos enteros para
        // no depender de cómo el modelo escribió el número.
        cashCents: cents(positiveNumber(input, "presupuestoTotal")),
        accreditedDepositCents: cents(positiveNumber(input, "anticipo")),
        maxMonthlyPaymentCents: cents(positiveNumber(input, "cuotaMaxima")),
        // Sin plazos declarados se usan los que ofrece el tarifario vigente,
        // no una lista escrita a mano acá.
        acceptedTerms: requestedTerms(input, dependencies),
        preferences: {
          preferredBrands: stringList(input, "marcas"),
          preferredVehicleTypes: stringList(input, "tipos"),
        },
      },
      dependencies,
    )) as Record<string, unknown>;
  } catch (error) {
    try {
      rethrowApplicationError(error);
    } catch (mapped) {
      return failure(mapped);
    }
  }

  const rows = Array.isArray(result.results) ? result.results : [];
  const opciones = rows.slice(0, MAX_RECOMMENDATIONS).map((row) => {
    const item = row as Record<string, unknown>;
    const vehicle = (item.vehicle ?? {}) as Record<string, unknown>;
    const evaluation = (item.evaluation ?? {}) as Record<string, unknown>;
    const breakdown = (evaluation.breakdown ?? {}) as Record<string, unknown>;
    // Una unidad cuyo dato de stock venció no se ofrece con precio ni cuota:
    // se ofrece para consultar disponibilidad, igual que en la web.
    const vigente = vehicle.available !== false;
    return {
      vehicleId: vehicle.id,
      vehicleSlug: vehicle.slug,
      marca: vehicle.brand,
      modelo: vehicle.model,
      anio: vehicle.year,
      tipo: vehicle.type,
      estado: item.status,
      estadoTexto: item.statusLabel,
      motivos: item.reasonDetails ?? [],
      disponibilidad: vigente ? "confirmada" : "consultar",
      precio: vigente ? money(breakdown.effectivePrice) : null,
      cuotaEstimada: vigente ? money(breakdown.installment) : null,
      selectionVersion: item.selectionVersion,
    };
  });

  // Se recuerda qué ofreció el motor y con qué importes: simular sólo podrá
  // apuntar a una de estas unidades.
  context.session.lastSearch = {
    simulationInput: result.simulationInput ?? null,
    options: new Map(
      opciones
        .filter((opcion) => typeof opcion.selectionVersion === "string")
        .map((opcion) => [
          String(opcion.vehicleId),
          {
            vehicleId: String(opcion.vehicleId),
            vehicleSlug: String(opcion.vehicleSlug),
            selectionVersion: String(opcion.selectionVersion),
          },
        ]),
    ),
  };

  return {
    ok: true,
    data: {
      opciones,
      totalEvaluadas: rows.length,
      fuente: access.source,
      // El asesor tiene que decirlo cuando corresponde: si el tarifario es
      // DEMO, ninguna cifra es una condición comercial real.
      avisos: Array.isArray(result.disclaimers) ? result.disclaimers : [],
      evaluadoEn: result.evaluatedAt ?? now.toISOString(),
    },
  };
}

async function simularOperacion(
  input: Record<string, unknown>,
  context: AdvisorToolContext,
): Promise<AdvisorToolResult> {
  const search = context.session.lastSearch;
  const chosen = search?.options.get(String(input.vehicleId ?? ""));
  // Sin búsqueda previa no hay nada que simular, y una unidad que el motor no
  // ofreció no se simula aunque el modelo la nombre bien.
  if (!search || !chosen) {
    return {
      ok: false,
      code: "SELECTION_NOT_FROM_SEARCH",
      message: "Buscá unidades antes de simular y usá una de las que devolvió la búsqueda.",
    };
  }
  if (
    chosen.selectionVersion !== String(input.selectionVersion ?? "") ||
    chosen.vehicleSlug !== String(input.vehicleSlug ?? "")
  ) {
    return {
      ok: false,
      code: "SELECTION_NOT_FROM_SEARCH",
      message: "Los datos de la unidad no coinciden con los que devolvió la búsqueda.",
    };
  }

  const idempotencyKey =
    context.idempotencyKey ?? `advisor-${context.conversationId}-${chosen.selectionVersion.slice(0, 16)}`;
  // Se reusa el mismo circuito que la web: misma validación, misma
  // idempotencia y el mismo snapshot congelado que ve el vendedor. Los
  // importes son los que normalizó la búsqueda, no los que repita el modelo.
  const request = new Request("https://internal/api/v1/simulations", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      vehicleId: chosen.vehicleId,
      vehicleSlug: chosen.vehicleSlug,
      selectionVersion: chosen.selectionVersion,
      simulationInput: search.simulationInput,
    }),
  });

  const response = await createSimulationResponse(request, {
    ...(context.access ? { access: context.access } : {}),
    ...(context.now ? { now: context.now } : {}),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = (payload.error ?? {}) as Record<string, unknown>;
    return {
      ok: false,
      code: typeof error.code === "string" ? error.code : "SIMULATION_REJECTED",
      message:
        typeof error.message === "string"
          ? error.message
          : "No se pudo simular la operación.",
    };
  }

  const data = (payload.data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      // El código público es lo que el cliente puede citar y el vendedor abrir:
      // el asesor debe mandarlo junto con cualquier cifra.
      codigo: data.code ?? data.publicCode ?? null,
      estado: data.classification ?? data.status ?? null,
      importes: data.breakdown ?? data.totals ?? null,
      vence: data.expiresAt ?? null,
      avisos: data.disclaimers ?? [],
    },
  };
}

/** Vigencia por defecto de una demanda sin plazo declarado. */
const DEFAULT_DEMAND_DAYS = 30;
const MIN_DEMAND_DAYS = 7;

type NormalizedCriteria = Readonly<{
  makes: readonly string[];
  models: readonly string[];
  types: readonly string[];
  minYear: number | null;
  maxPriceCents: number | null;
  maxMileageKm: number | null;
  currency: string;
  tradeIn: boolean;
  urgencyDays: number | null;
}>;

/** Resumen en palabras del cliente, para leérselo y que lo corrija. */
function demandSummary(criteria: NormalizedCriteria): string {
  const parts: string[] = [];
  const buscado = [...criteria.models, ...criteria.makes, ...criteria.types].slice(0, 3).join(" / ");
  if (buscado) parts.push(`Busca ${buscado}`);
  if (criteria.minYear !== null) parts.push(`desde ${criteria.minYear}`);
  if (criteria.maxPriceCents !== null) {
    parts.push(
      `hasta ${criteria.currency} ${Math.round(criteria.maxPriceCents / 100).toLocaleString("es-AR")}`,
    );
  }
  if (criteria.maxMileageKm !== null) {
    parts.push(`hasta ${criteria.maxMileageKm.toLocaleString("es-AR")} km`);
  }
  if (criteria.tradeIn) parts.push("entrega un usado");
  if (criteria.urgencyDays !== null) parts.push(`quiere comprar en ${criteria.urgencyDays} días`);
  return `${parts.join(", ")}.`;
}

async function registrarDemanda(
  input: Record<string, unknown>,
  context: AdvisorToolContext,
): Promise<AdvisorToolResult> {
  const now = context.now ?? new Date();
  const inbox = context.outboundRuntime?.repository ?? new D1ChannelInboxRepository();
  const conversation = await inbox.findConversationForOutbound(context.conversationId);
  // Sin lead no hay a quién asociar la demanda: en Instagram sin teléfono, el
  // asesor tiene que pedirlo antes de registrar nada.
  if (!conversation?.leadId) {
    return {
      ok: false,
      code: "LEAD_REQUIRED",
      message: "Falta el contacto del cliente: pedile el teléfono antes de registrar la demanda.",
    };
  }

  let criteria: NormalizedCriteria;
  try {
    criteria = normalizeDemandCriteria({
      makes: Array.isArray(input.marcas) ? input.marcas : [],
      models: Array.isArray(input.modelos) ? input.modelos : [],
      types: Array.isArray(input.tipos) ? input.tipos : [],
      minYear: input.anioMinimo ?? null,
      maxPriceCents: cents(positiveNumber(input, "presupuestoMaximo")),
      maxMileageKm: input.kilometrajeMaximo ?? null,
      currency: String(input.moneda ?? "ARS").toUpperCase(),
      tradeIn: input.entregaUsado === true,
      urgencyDays: input.diasParaComprar ?? null,
    }) as NormalizedCriteria;
  } catch (error) {
    return {
      ok: false,
      code: "INVALID_DEMAND",
      message: error instanceof Error ? error.message : "La demanda no es válida.",
    };
  }

  const repository = context.demandRepository ?? new D1DemandRepository();
  // El mismo evento entrante vuelve a ejecutar el turno en algunos reintentos.
  // El pasaporte conserva una identidad estable para que INSERT OR IGNORE no
  // deje otro borrador; el mensaje saliente usa la misma idempotency key.
  const passportId = await advisorStableId("advisor-passport", {
    inbound: context.idempotencyKey ?? null,
    conversationId: conversation.id,
  });
  const reviewToken = generateSessionToken();
  const reviewTokenHash = await hashSessionToken(reviewToken);
  await repository.createPassport({
    id: passportId,
    leadId: conversation.leadId,
    conversationId: conversation.id,
    reviewTokenHash,
    budgetCents: criteria.maxPriceCents,
    downPaymentCents: null,
    maxMonthlyPaymentCents: null,
    currency: criteria.currency,
    desiredMakes: criteria.makes,
    desiredModels: criteria.models,
    acceptedTypes: criteria.types,
    minYear: criteria.minYear,
    maxMileageKm: criteria.maxMileageKm,
    primaryUse: null,
    needsFinancing: null,
    tradeInDescription:
      typeof input.descripcionUsado === "string" ? input.descripcionUsado.slice(0, 200) : null,
    urgencyDays: criteria.urgencyDays,
    locality: typeof input.localidad === "string" ? input.localidad.slice(0, 80) : null,
    maxDistanceKm: null,
    mandatoryConditions: [],
    negotiableConditions: [],
    createdAt: now.toISOString(),
  });

  const days = Math.max(criteria.urgencyDays ?? DEFAULT_DEMAND_DAYS, MIN_DEMAND_DAYS);
  const resumen = demandSummary(criteria);
  context.session.pendingDemand = {
    passportId,
    leadId: conversation.leadId,
    criteria,
    validUntil: new Date(now.getTime() + days * 86_400_000).toISOString(),
    resumen,
  };

  return {
    ok: true,
    data: {
      passportId,
      resumen,
      enlaceRevision: reviewUrl(reviewToken),
      // El dato es del cliente: lo corrige antes de que se busque a su nombre.
      instruccion:
        "Mandale el enlace de revisión: allí puede corregir y confirmar la búsqueda. " +
        "No queda registrada hasta esa confirmación. Si no puede abrirlo, leele el resumen y usá confirmar_demanda sólo cuando lo apruebe.",
    },
  };
}

async function registrarPermuta(
  input: Record<string, unknown>,
  context: AdvisorToolContext,
): Promise<AdvisorToolResult> {
  const now = context.now ?? new Date();
  const inbox = context.outboundRuntime?.repository ?? new D1ChannelInboxRepository();
  const conversation = await inbox.findConversationForOutbound(context.conversationId);
  if (!conversation?.leadId) {
    return { ok: false, code: "LEAD_REQUIRED", message: "Falta el contacto para registrar la permuta." };
  }

  const declaredCondition = requiredText(input, "estadoDeclarado", 1, 40).toUpperCase();
  if (!new Set(["EXCELLENT", "GOOD", "FAIR", "NEEDS_REPAIR"]).has(declaredCondition)) {
    return { ok: false, code: "INVALID_TRADE_IN", message: "El estado declarado no es válido." };
  }
  const command = {
    leadId: conversation.leadId,
    make: requiredText(input, "marca", 2, 60),
    model: requiredText(input, "modelo", 1, 80),
    trim: optionalText(input, "version", 80),
    year: requiredIntegerValue(input, "anio", 1950, now.getUTCFullYear() + 1),
    mileageKm: requiredIntegerValue(input, "kilometraje", 0, 3_000_000),
    declaredCondition,
    documentationStatus: optionalText(input, "estadoDocumentacion", 60),
    hasLien: input.tienePrenda === true,
    repairNotes: optionalText(input, "observaciones", 2_000),
  };
  const key = await advisorStableId("advisor-appraisal", { inbound: context.idempotencyKey ?? null, command });
  const access = context.access ?? getDataAccess();
  const id = crypto.randomUUID();
  const appraisal = await access.appraisals.create({
    id,
    publicCode: publicCode("TAS"),
    idempotencyKey: key,
    leadId: command.leadId,
    make: command.make,
    model: command.model,
    trim: command.trim,
    year: command.year,
    mileageKm: command.mileageKm,
    declaredCondition: command.declaredCondition,
    documentationStatus: command.documentationStatus,
    hasLien: command.hasLien,
    repairNotes: command.repairNotes,
    status: "SUBMITTED",
    certaintyLevel: "T0",
  });
  await inbox.recordConversationEvent({
    id: await advisorStableId("advisor-appraisal-event", { key }),
    conversationId: conversation.id,
    type: "TRADE_IN_SUBMITTED",
    actorType: "AI",
    actorId: "asesor",
    metadataJson: JSON.stringify({ appraisalCode: appraisal.publicCode, certainty: "T0" }),
    occurredAt: now.toISOString(),
  });
  return {
    ok: true,
    data: {
      codigo: appraisal.publicCode,
      estado: "SUBMITTED",
      certeza: "T0",
      requiereRevision: true,
      mensajeCliente:
        "Tomé los datos de tu usado para que una persona del equipo lo revise. La tasación queda pendiente de revisión física y documental; no puedo confirmar un valor ni la toma todavía.",
    },
  };
}

async function cotizarPermuta(input: Record<string, unknown>, context: AdvisorToolContext): Promise<AdvisorToolResult> {
  const now = context.now ?? new Date();
  const published = await (context.appraisalRulesetRepository ?? new D1AppraisalRulesetRepository()).findCurrent(now);
  if (!published) return { ok: true, data: { requiereRevision: true, mensajeCliente: "No tenemos una referencia vigente para cotizar tu usado. Una persona del equipo lo revisa física y documentalmente." } };
  const range = estimateAppraisalRange(published.ruleset, {
    make: requiredText(input, "marca", 2, 60), model: requiredText(input, "modelo", 1, 80),
    year: requiredIntegerValue(input, "anio", 1950, now.getUTCFullYear() + 1), mileageKm: requiredIntegerValue(input, "kilometraje", 0, 3_000_000),
    declaredCondition: requiredText(input, "estadoDeclarado", 1, 40).toUpperCase(), hasLien: input.tienePrenda === true,
  }, { now, certainty: "T0" });
  if (!range.estimable) return { ok: true, data: { requiereRevision: true, mensajeCliente: range.mensaje } };
  const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: range.currency, maximumFractionDigits: 0 });
  return { ok: true, data: { requiereRevision: true, rango: { desdeCents: range.lowCents, hastaCents: range.highCents, moneda: range.currency, versionTarifario: published.version }, mensajeCliente: `El rango preliminar es entre ${money.format(range.lowCents / 100)} y ${money.format(range.highCents / 100)}. ${range.aviso}` } };
}

async function solicitarVisita(
  input: Record<string, unknown>,
  context: AdvisorToolContext,
): Promise<AdvisorToolResult> {
  const rawRequestedAt = requiredText(input, "fechaHoraSolicitada", 20, 50);
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(rawRequestedAt)) {
    return { ok: false, code: "INVALID_VISIT_TIME", message: "Pedí fecha, hora y zona horaria para la visita." };
  }
  const requestedMs = Date.parse(rawRequestedAt);
  const now = context.now ?? new Date();
  if (!Number.isFinite(requestedMs) || requestedMs <= now.getTime() || requestedMs > now.getTime() + 60 * 86_400_000) {
    return { ok: false, code: "INVALID_VISIT_TIME", message: "La visita debe ser futura y dentro de los próximos 60 días." };
  }
  const rawVehicleId = optionalText(input, "vehicleId", 100);
  if (rawVehicleId && !context.session.lastSearch?.options.has(rawVehicleId)) {
    return {
      ok: false,
      code: "SELECTION_NOT_FROM_SEARCH",
      message: "Esa unidad no salió de la búsqueda actual. Buscá antes de pedir la visita.",
    };
  }
  const inbox = context.outboundRuntime?.repository ?? new D1ChannelInboxRepository();
  const conversation = await inbox.findConversationForOutbound(context.conversationId);
  if (!conversation?.leadId) {
    return { ok: false, code: "LEAD_REQUIRED", message: "Falta el contacto para pedir la visita." };
  }
  const requestedAt = new Date(requestedMs).toISOString();
  const note = optionalText(input, "nota", 500);
  const id = await advisorStableId("visit", {
    inbound: context.idempotencyKey ?? null,
    conversationId: conversation.id,
    requestedAt,
    vehicleId: rawVehicleId,
    note,
  });
  const created = await (context.visitRepository ?? new D1VisitRequestRepository()).createRequest({
    id,
    eventId: await advisorStableId("visit-event", { id }),
    conversationId: conversation.id,
    leadId: conversation.leadId,
    vehicleId: rawVehicleId,
    requestedAt,
    assignedTo: conversation.assignedTo,
    note,
    createdAt: now.toISOString(),
  });
  if (!created) {
    return { ok: false, code: "VISIT_NOT_CREATED", message: "No se pudo registrar la solicitud de visita." };
  }
  return {
    ok: true,
    data: {
      solicitudRegistrada: true,
      requiereConfirmacionHumana: true,
      mensajeCliente:
        "Dejé registrada tu solicitud. Una persona del equipo tiene que confirmar la disponibilidad y el horario antes de darte el turno por confirmado.",
    },
  };
}

async function confirmarDemanda(
  input: Record<string, unknown>,
  context: AdvisorToolContext,
): Promise<AdvisorToolResult> {
  const pending = context.session.pendingDemand;
  // Sólo se confirma lo que se acaba de proponer y leer: el asesor no puede
  // confirmar una demanda que el cliente nunca escuchó.
  if (!pending || pending.passportId !== String(input.passportId ?? "")) {
    return {
      ok: false,
      code: "DEMAND_NOT_PROPOSED",
      message: "Registrá la demanda y leésela al cliente antes de confirmarla.",
    };
  }
  const now = context.now ?? new Date();
  const repository = context.demandRepository ?? new D1DemandRepository();
  const confirmed = await repository.confirmPassport({
    passportId: pending.passportId,
    confirmedAt: now.toISOString(),
  });
  if (!confirmed) {
    return {
      ok: false,
      code: "DEMAND_ALREADY_CONFIRMED",
      message: "Esa demanda ya estaba confirmada.",
    };
  }

  const demandId = crypto.randomUUID();
  const publicCode = `DEM-${demandId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
  await repository.createDemand({
    id: demandId,
    publicCode,
    passportId: pending.passportId,
    leadId: pending.leadId,
    criteria: pending.criteria,
    validUntil: pending.validUntil,
    assignedTo: null,
    createdAt: now.toISOString(),
  });
  context.session.pendingDemand = null;

  return {
    ok: true,
    data: {
      codigo: publicCode,
      vigenteHasta: pending.validUntil,
      instruccion:
        "Decile que quedó anotado y que le avisamos si entra algo que coincida. " +
        "No prometas cuándo ni asegures que va a aparecer.",
    },
  };
}

async function escalar(
  input: Record<string, unknown>,
  context: AdvisorToolContext,
): Promise<AdvisorToolResult> {
  const motivo = typeof input.motivo === "string" ? input.motivo.trim() : "";
  await escalateToHuman(
    {
      conversationId: context.conversationId,
      reason: motivo.length > 0 ? motivo : "SIN_MOTIVO",
    },
    context.outboundRuntime ?? {},
  );
  return {
    ok: true,
    data: {
      escalado: true,
      // La escalada no promete tiempos: no los sabemos.
      instruccion:
        "Avisale al cliente que lo sigue una persona del equipo y no prometas plazos ni condiciones.",
    },
  };
}

/**
 * Único punto por el que el asesor toca el negocio. Cualquier cifra que
 * termine en un mensaje sale de acá; el modelo no calcula, no recuerda precios
 * y no elige stock.
 */
export async function runAdvisorTool(
  name: string,
  input: unknown,
  context: AdvisorToolContext,
): Promise<AdvisorToolResult> {
  const args =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  try {
    if (name === "buscar_vehiculos") return await buscarVehiculos(args, context);
    if (name === "simular_operacion") return await simularOperacion(args, context);
    if (name === "registrar_demanda") return await registrarDemanda(args, context);
    if (name === "confirmar_demanda") return await confirmarDemanda(args, context);
    if (name === "registrar_permuta") return await registrarPermuta(args, context);
    if (name === "cotizar_permuta") return await cotizarPermuta(args, context);
    if (name === "solicitar_visita") return await solicitarVisita(args, context);
    if (name === "escalar_a_persona") return await escalar(args, context);
    return {
      ok: false,
      code: "UNKNOWN_TOOL",
      message: "Esa herramienta no existe.",
    };
  } catch (error) {
    return failure(error);
  }
}
