export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const MAX_JSON_BODY_BYTES = 64 * 1024;

const SAFE_JSON_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
});

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(SAFE_JSON_HEADERS)) {
    headers.set(name, value);
  }
  return Response.json(data, {
    ...init,
    headers,
  });
}

export async function apiRoute(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) {
      return json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.fields ? { fields: error.fields } : {}),
          },
        },
        { status: error.status },
      );
    }

    console.error("api_v1_unhandled_error", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return json(
      { error: { code: "INTERNAL_ERROR", message: "No pudimos completar la operación." } },
      { status: 500 },
    );
  }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  assertJsonContentType(request.headers.get("Content-Type"));
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new ApiError(400, "INVALID_CONTENT_LENGTH", "El tamaño declarado no es válido.");
    }
    if (bytes > MAX_JSON_BODY_BYTES) throw payloadTooLarge();
  }

  const bytes = await readLimitedBody(request);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "El cuerpo debe ser JSON válido.");
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "El cuerpo debe ser JSON válido.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_PAYLOAD", "El cuerpo debe ser un objeto JSON.");
  }
  return value as Record<string, unknown>;
}

function assertJsonContentType(value: string | null): void {
  const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const valid =
    mediaType === "application/json" ||
    (mediaType.startsWith("application/") && mediaType.endsWith("+json"));
  if (!valid) {
    throw new ApiError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "El encabezado Content-Type debe indicar JSON.",
    );
  }
}

async function readLimitedBody(request: Request): Promise<Uint8Array> {
  if (!request.body) {
    throw new ApiError(400, "INVALID_JSON", "El cuerpo debe ser JSON válido.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BODY_BYTES) {
        try {
          await reader.cancel("payload_too_large");
        } catch {
          // The stable 413 response takes precedence over transport cleanup errors.
        }
        throw payloadTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function payloadTooLarge(): ApiError {
  return new ApiError(
    413,
    "PAYLOAD_TOO_LARGE",
    `El cuerpo JSON no puede superar ${MAX_JSON_BODY_BYTES} bytes.`,
  );
}

export function requiredString(
  object: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number } = {},
): string {
  const value = object[key];
  const normalized = typeof value === "string" ? value.trim() : "";
  const min = options.min ?? 1;
  const max = options.max ?? 200;
  if (normalized.length < min || normalized.length > max) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      [key]: `Debe tener entre ${min} y ${max} caracteres.`,
    });
  }
  return normalized;
}

export function optionalString(
  object: Record<string, unknown>,
  key: string,
  max = 500,
): string | undefined {
  const value = object[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length > max) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      [key]: `Debe ser texto de hasta ${max} caracteres.`,
    });
  }
  return value.trim();
}

export function requiredInteger(
  object: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number } = {},
): number {
  const value = object[key];
  const min = options.min ?? 0;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      [key]: `Debe ser un entero entre ${min} y ${max}.`,
    });
  }
  return value as number;
}

export function optionalInteger(
  object: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number } = {},
): number | undefined {
  if (object[key] === undefined || object[key] === null) return undefined;
  return requiredInteger(object, key, options);
}

export function optionalBoolean(object: Record<string, unknown>, key: string): boolean | undefined {
  const value = object[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      [key]: "Debe ser verdadero o falso.",
    });
  }
  return value;
}

export function requireIdempotencyKey(request: Request): string {
  const value = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    throw new ApiError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Se requiere un encabezado Idempotency-Key válido.",
    );
  }
  return value;
}

export function normalizePhone(value: string): string {
  const hasPlus = value.trim().startsWith("+");
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      phone: "Ingresá un teléfono válido con código de área.",
    });
  }
  return `${hasPlus ? "+" : ""}${digits}`;
}

export async function stableToken(seed: string, length = 10): Promise<string> {
  const bytes = new TextEncoder().encode(seed);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length)
    .toUpperCase();
}

export function publicCode(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;
}
