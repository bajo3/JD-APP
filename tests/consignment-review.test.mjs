import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

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
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
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

const admin = await import("../lib/admin/index.ts");
const {
  getAdminConsignment,
  listAdminConsignments,
  reviewAdminConsignment,
  AdminError,
} = admin;

const NOW = new Date("2026-08-19T15:00:00.000Z");
const actor = { userId: "operator-1", email: "operador@jd.example", displayName: "Operador" };

function consignment(overrides = {}) {
  return {
    id: "consignment-1",
    leadId: "lead-1",
    vehicleDescription: "Toyota Corolla",
    year: 2020,
    mileageKm: 48000,
    status: "SUBMITTED",
    askingPriceCents: 12_000_000_00,
    currency: "ARS",
    ownerNotes: "Siempre garage.",
    notes: null,
    reviewedBy: null,
    decidedAt: null,
    version: 1,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
    isDemo: false,
    ...overrides,
  };
}

function dependencies(repository = {}) {
  let generated = 0;
  return {
    authorize: async () => actor,
    clock: () => new Date(NOW),
    idGenerator: () => `generated-${++generated}`,
    repositories: {
      consignments: {
        async list() { return []; },
        async findById() { return consignment(); },
        async countReadyMedia() { return 5; },
        async review(input) {
          return { ok: true, record: consignment({ ...input, status: input.status, version: input.expectedVersion + 1 }) };
        },
        ...repository,
      },
    },
  };
}

test("la revisión exige el camino SUBMITTED → IN_REVIEW → decisión", async () => {
  await assert.rejects(
    () => reviewAdminConsignment(dependencies(), { id: "consignment-1", expectedVersion: 1, nextStatus: "ACCEPTED" }),
    (error) => error instanceof AdminError && error.code === "ADMIN_INVALID_TRANSITION",
  );

  await assert.rejects(
    () => reviewAdminConsignment(
      dependencies({ findById: async () => consignment({ status: "ACCEPTED" }) }),
      { id: "consignment-1", expectedVersion: 2, nextStatus: "REJECTED" },
    ),
    (error) => error instanceof AdminError && error.code === "ADMIN_INVALID_TRANSITION",
  );
});

test("iniciar revisión exige exactamente cinco fotos READY del lado del servidor", async () => {
  const incomplete = dependencies({ countReadyMedia: async () => 3 });
  await assert.rejects(
    () => reviewAdminConsignment(incomplete, {
      id: "consignment-1",
      expectedVersion: 1,
      nextStatus: "IN_REVIEW",
    }),
    (error) =>
      error instanceof AdminError &&
      error.code === "ADMIN_INVALID_TRANSITION" &&
      error.details.readyPhotos === 3 &&
      error.details.requiredPhotos === 5,
  );

  let mutation;
  const deps = dependencies({
    countReadyMedia: async () => 5,
    review: async (input) => {
      mutation = input;
      return { ok: true, record: consignment({ ...input, status: "IN_REVIEW", version: 2 }) };
    },
  });
  const result = await reviewAdminConsignment(deps, {
    id: "consignment-1",
    expectedVersion: 1,
    nextStatus: "IN_REVIEW",
    notes: "Fotos completas, llamar al dueño.",
  });
  assert.equal(result.status, "IN_REVIEW");
  assert.equal(result.notes, "Fotos completas, llamar al dueño.");
  assert.deepEqual(mutation.actor, actor);
  assert.equal(mutation.audit.entityType, "CONSIGNMENT");
  assert.equal(mutation.audit.action, "CONSIGNMENT_STATUS_CHANGED");
  assert.equal(mutation.audit.summary.publishesStock, false);
});

test("aceptar registra decisión y rechazar exige pasar por revisión", async () => {
  let decided;
  const deps = dependencies({
    findById: async () => consignment({ status: "IN_REVIEW", version: 2 }),
    review: async (input) => {
      decided = input;
      return { ok: true, record: consignment({ status: input.status, version: 3, decidedAt: NOW.toISOString() }) };
    },
  });
  const accepted = await reviewAdminConsignment(deps, {
    id: "consignment-1",
    expectedVersion: 2,
    nextStatus: "ACCEPTED",
  });
  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(decided.status, "ACCEPTED");

  const rejected = await reviewAdminConsignment(deps, {
    id: "consignment-1",
    expectedVersion: 2,
    nextStatus: "REJECTED",
    notes: "Unidad con deudas informadas.",
  });
  assert.equal(rejected.status, "REJECTED");
});

test("lecturas reautorizan y el conflicto de versión se informa estable", async () => {
  const denied = dependencies();
  denied.authorize = async () => { throw new Error("DENIED"); };
  await assert.rejects(() => listAdminConsignments(denied), /DENIED/);
  await assert.rejects(() => getAdminConsignment(denied, "consignment-1"), /DENIED/);

  const conflicted = dependencies({
    findById: async () => consignment({ status: "IN_REVIEW", version: 7 }),
    review: async () => ({ ok: false, reason: "conflict", currentVersion: 7 }),
  });
  await assert.rejects(
    () => reviewAdminConsignment(conflicted, { id: "consignment-1", expectedVersion: 2, nextStatus: "ACCEPTED" }),
    (error) => error instanceof AdminError && error.code === "ADMIN_VERSION_CONFLICT" && error.status === 409,
  );
});

test("el formulario público ofrece exactamente cinco fotos guiadas y no finaliza antes", async () => {
  const captures = readFileSync("app/_components/consignment/captures.ts", "utf8");
  for (const capture of ["FRONT", "REAR", "SIDE", "INTERIOR", "DASHBOARD"]) {
    assert.match(captures, new RegExp(`type: "${capture}"`));
  }
  assert.equal((captures.match(/type: "/g) ?? []).length, 5);

  const client = readFileSync("app/_components/consignment/photo-client.ts", "utf8");
  assert.match(client, /\/api\/v1\/consignments/);
  assert.match(client, /X-Capture-Type/);
  const form = readFileSync("app/_components/ConsignmentForm.tsx", "utf8");
  assert.match(form, /doneCount < CAPTURES\.length/);
  // La clave de idempotencia es estable por alta y por captura: nunca se
  // regenera dentro del fetch de un reintento.
  assert.match(form, /creationKeyRef\.current \?\?= crypto\.randomUUID\(\)/);
  assert.match(form, /slotKeysRef\.current\[type\] = crypto\.randomUUID\(\)/);
  assert.doesNotMatch(form, /IDEMPOTENCY\s*=\s*\(\)/);
  // Cada preview de blob se revoca al reemplazarse o desmontarse.
  assert.match(form, /URL\.revokeObjectURL/);

  assert.match(client, /Authorization: `Bearer \$\{input\.uploadToken\}`/);

  const page = readFileSync("app/consignar-mi-auto/page.tsx", "utf8");
  assert.match(page, /CONSIGNACIÓN VIRTUAL/);
  assert.match(page, /ConsignmentForm/);
});

test("la ruta pública de fotos expone sólo POST y usa el código CON-", async () => {
  const source = readFileSync("app/api/v1/consignments/[code]/photos/route.ts", "utf8");
  assert.match(source, /export async function POST/);
  assert.doesNotMatch(source, /export async function GET/);

  const server = readFileSync("lib/server/consignment-media.ts", "utf8");
  assert.match(server, /private, no-store/);
  assert.match(server, /putPrivateConsignmentImage/);
  assert.match(server, /stripImageMetadata/);
  assert.match(server, /\^CON-\[0-9A-F\]\{6\}\$/);
  // La carga exige el bearer entregado en el alta: el código público solo no
  // alcanza, y el token jamás viaja en la URL.
  assert.match(server, /Authorization/);
  assert.match(server, /uploadTokenHash !== tokenHash/);
  assert.doesNotMatch(server, /photos\?token/);
});

test("el panel mantiene las fotos detrás del detalle privado", async () => {
  const detail = readFileSync("app/panel/consignaciones/[id]/page.tsx", "utf8");
  assert.match(detail, /getAdminConsignmentDetailData/);
  assert.match(detail, /photo\.url/);
  assert.match(detail, /Fotos de la unidad/);
  assert.match(detail, /appraisal-photo-grid/);
  assert.match(detail, /circuito manual de stock/);

  const list = readFileSync("app/panel/consignaciones/page.tsx", "utf8");
  assert.match(list, /linkBase:"\/panel\/consignaciones\/"/);
  assert.match(list, /resource="consignment"/);

  const form = readFileSync("app/panel/_components/AdminResourceForm.tsx", "utf8");
  assert.match(form, /api\/v1\/admin\/consignments/);
});
