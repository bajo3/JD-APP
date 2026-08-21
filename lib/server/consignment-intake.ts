import { sha256Canonical } from "@/lib/crm/index.mjs";
import {
  D1ConsignmentIntakeRepository,
  type ConsignmentIntakeRecord,
  type ConsignmentIntakeRepositoryLike,
} from "@/lib/data/consignment-intake-repository";
import {
  ApiError,
  apiRoute,
  json,
  normalizePhone,
  optionalInteger,
  optionalString,
  readJsonObject,
  requireIdempotencyKey,
  requiredInteger,
  requiredString,
} from "./api";

const DECLARED_CONDITIONS = new Set(["EXCELLENT", "GOOD", "FAIR", "NEEDS_REPAIR"]);
const CONSIGNMENT_LEAD_SOURCE = "CONSIGNACION_WEB";

export type ConsignmentIntakeRuntime = Readonly<{
  repository?: ConsignmentIntakeRepositoryLike;
  now?: Date;
  idGenerator?: () => string;
  codeGenerator?: () => string;
}>;

/**
 * La autorización de carga es un capability de 256 bits entregado una única
 * vez en el alta. Sólo se persiste su SHA-256: ni D1 ni los logs ni ninguna
 * respuesta posterior vuelven a contener el token.
 */
function generateUploadToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function generateConsignmentUploadToken(): Promise<{
  token: string;
  tokenHash: string;
}> {
  const token = generateUploadToken();
  return { token, tokenHash: await sha256Hex(token) };
}

function intakeCommandHash(input: {
  name: string;
  phoneNormalized: string;
  email: string | null;
  vehicle: Record<string, unknown>;
}): Promise<string> {
  return sha256Canonical({
    schemaVersion: "jda.v1.consignment-intake-command.v1",
    identity: {
      name: input.name,
      phoneNormalized: input.phoneNormalized,
      email: input.email,
    },
    command: {
      contactConsent: true,
      source: CONSIGNMENT_LEAD_SOURCE,
      vehicle: input.vehicle,
    },
  });
}

function parseVehicle(payload: Record<string, unknown>): {
  vehicle: Record<string, unknown>;
  make: string;
  model: string;
  trim: string | null;
  year: number;
  mileageKm: number;
  declaredCondition: string;
  askingPriceCents: number | null;
  ownerNotes: string | null;
} {
  const vehicleValue = payload.vehicle;
  if (!vehicleValue || typeof vehicleValue !== "object" || Array.isArray(vehicleValue)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      vehicle: "Completá los datos del vehículo.",
    });
  }
  const vehicle = vehicleValue as Record<string, unknown>;
  const declaredCondition = requiredString(vehicle, "declaredCondition", { min: 2, max: 40 }).toUpperCase();
  if (!DECLARED_CONDITIONS.has(declaredCondition)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      declaredCondition: "El estado declarado no es válido.",
    });
  }
  return {
    vehicle,
    make: requiredString(vehicle, "make", { min: 2, max: 60 }),
    model: requiredString(vehicle, "model", { min: 1, max: 80 }),
    trim: optionalString(vehicle, "trim", 80) ?? null,
    year: requiredInteger(vehicle, "year", { min: 1950, max: new Date().getFullYear() + 1 }),
    mileageKm: requiredInteger(vehicle, "mileageKm", { min: 0, max: 3_000_000 }),
    declaredCondition,
    askingPriceCents:
      optionalInteger(vehicle, "askingPriceCents", { min: 1, max: 10_000_000_000_00 }) ?? null,
    ownerNotes: optionalString(vehicle, "ownerNotes", 2_000) ?? null,
  };
}

export function createConsignmentIntake(
  request: Request,
  runtime: ConsignmentIntakeRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    const idempotencyKey = requireIdempotencyKey(request);
    const payload = await readJsonObject(request);
    if (payload.contactConsent !== true) {
      throw new ApiError(
        422,
        "CONTACT_CONSENT_REQUIRED",
        "Necesitamos tu permiso para responder la consulta.",
        { contactConsent: "Debe aceptarse para enviar la consulta." },
      );
    }
    const name = requiredString(payload, "name", { min: 2, max: 120 });
    const phoneNormalized = normalizePhone(requiredString(payload, "phone", { min: 8, max: 40 }));
    const email = optionalString(payload, "email", 254) ?? null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
        email: "Ingresá un correo válido.",
      });
    }
    const parsed = parseVehicle(payload);

    const commandHash = await intakeCommandHash({
      name,
      phoneNormalized,
      email,
      vehicle: parsed.vehicle,
    });
    const { token, tokenHash } = await generateConsignmentUploadToken();
    const occurredAt = (runtime.now ?? new Date()).toISOString();
    const leadId = runtime.idGenerator?.() ?? crypto.randomUUID();

    const repository = runtime.repository ?? new D1ConsignmentIntakeRepository();
    const result = await repository.create({
      consignmentId: `consignment-${leadId}`,
      leadId,
      consentId: `consent-${leadId}`,
      publicCode: runtime.codeGenerator?.() ?? `CON-${crypto.randomUUID()
        .replaceAll("-", "")
        .slice(0, 6)
        .toUpperCase()}`,
      idempotencyKey,
      commandHash,
      uploadTokenHash: tokenHash,
      owner: { name, phoneNormalized, email, source: CONSIGNMENT_LEAD_SOURCE },
      vehicle: {
        make: parsed.make,
        model: parsed.model,
        trim: parsed.trim,
        year: parsed.year,
        mileageKm: parsed.mileageKm,
        declaredCondition: parsed.declaredCondition,
        askingPriceCents: parsed.askingPriceCents,
        ownerNotes: parsed.ownerNotes,
      },
      consent: {
        channel: "WHATSAPP_OR_PHONE",
        purpose: "CONTACT_REQUEST",
        evidenceJson: JSON.stringify({
          method: "api_v1_consignment_intake",
          privacyPolicyVersion: optionalString(payload, "privacyPolicyVersion", 64) ?? null,
        }),
      },
      occurredAt,
    });
    if (!result.ok) {
      throw new ApiError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "La clave ya fue usada para otra operación.",
      );
    }
    const data: Record<string, unknown> = {
      code: result.record.publicCode,
      status: result.record.status,
      createdAt: result.record.createdAt,
    };
    if (!result.replayed) data.uploadToken = token;
    return json(
      { data, meta: { idempotencyReplayed: result.replayed } },
      {
        status: result.replayed ? 200 : 201,
        headers: result.replayed ? { "Idempotency-Replayed": "true" } : undefined,
      },
    );
  });
}

export type { ConsignmentIntakeRecord };
