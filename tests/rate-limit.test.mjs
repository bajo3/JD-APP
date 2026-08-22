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

const { enforceRateLimit, withRateLimit } = await import("../lib/server/rate-limit.ts");
const { D1RateLimitRepository } = await import("../lib/data/rate-limit-repository.ts");

const AT = new Date("2026-08-21T12:00:00.000Z");

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

function rateDatabase() {
  const database = new DatabaseSync(":memory:");
  for (const path of [
    "drizzle/0010_rate_limit_windows.sql",
  ]) {
    database.exec(readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  return database;
}

function memoryRepository() {
  const rows = new Map();
  let expiredSweeps = 0;
  return {
    repository: {
      async hit({ key, resource, expiresAt }) {
        const row = rows.get(key);
        if (row) {
          row.hits += 1;
          return { hits: row.hits };
        }
        rows.set(key, { resource, expiresAt, hits: 1 });
        return { hits: 1 };
      },
      async removeExpired(nowIso) {
        expiredSweeps += 1;
        for (const [key, row] of rows) {
          if (row.expiresAt <= nowIso) rows.delete(key);
        }
      },
    },
    rows,
    expiredSweeps: () => expiredSweeps,
  };
}

function requestWithIp(ip = "203.0.113.10") {
  return new Request("http://localhost/api/v1/leads", {
    method: "POST",
    headers: { "CF-Connecting-IP": ip },
  });
}

test("el contador D1 incrementa por ventana y depura lo vencido", async () => {
  const repository = new D1RateLimitRepository(sqliteD1(rateDatabase()));
  const first = await repository.hit({
    key: "public.lead:203.0.113.10:2026-08-21T12:00:00.000Z",
    resource: "public.lead",
    expiresAt: "2026-08-21T12:10:00.000Z",
  });
  assert.deepEqual(first, { hits: 1 });
  const second = await repository.hit({
    key: "public.lead:203.0.113.10:2026-08-21T12:00:00.000Z",
    resource: "public.lead",
    expiresAt: "2026-08-21T12:10:00.000Z",
  });
  assert.deepEqual(second, { hits: 2 });

  await repository.removeExpired("2026-08-21T12:10:00.001Z");
  const after = await repository.hit({
    key: "public.lead:203.0.113.10:2026-08-21T12:00:00.000Z",
    resource: "public.lead",
    expiresAt: "2026-08-21T12:20:00.000Z",
  });
  assert.deepEqual(after, { hits: 1 });
});

test("la ventana agotada responde 429 estable con Retry-After y sin escrituras extra", async () => {
  const backend = memoryRepository();
  const runtime = { repository: backend.repository, now: AT };

  // RATE_LIMIT_PUBLIC_LEAD por defecto: 10 por 10 minutos.
  for (let i = 0; i < 10; i += 1) {
    await enforceRateLimit(requestWithIp(), "public.lead", runtime);
  }
  await assert.rejects(
    () => enforceRateLimit(requestWithIp(), "public.lead", runtime),
    (error) =>
      error.name === "ApiError" &&
      error.status === 429 &&
      error.code === "RATE_LIMITED" &&
      error.headers["Retry-After"] === "600",
  );
  assert.equal(backend.rows.size, 1);

  // Otra IP tiene contador propio.
  await enforceRateLimit(requestWithIp("198.51.100.7"), "public.lead", runtime);
  assert.equal(backend.rows.size, 2);
});

test("la ventana siguiente arranca de cero y el entorno puede ajustar el tope", async () => {
  process.env.RATE_LIMIT_PUBLIC_LEAD = "2";
  test.after(() => { delete process.env.RATE_LIMIT_PUBLIC_LEAD; });

  const backend = memoryRepository();
  const runtime = { repository: backend.repository, now: AT };
  await enforceRateLimit(requestWithIp(), "public.lead", runtime);
  await enforceRateLimit(requestWithIp(), "public.lead", runtime);
  await assert.rejects(() => enforceRateLimit(requestWithIp(), "public.lead", runtime));

  // Misma IP, ventana siguiente: contador nuevo.
  const nextWindow = new Date(AT.getTime() + 10 * 60_000 + 1);
  await enforceRateLimit(requestWithIp(), "public.lead", { ...runtime, now: nextWindow });
});

test("withRateLimit envuelve la ruta y responde 429 con el cuerpo estable", async () => {
  process.env.RATE_LIMIT_PUBLIC_CONSIGNMENT = "1";
  test.after(() => { delete process.env.RATE_LIMIT_PUBLIC_CONSIGNMENT; });

  const backend = memoryRepository();
  const handler = withRateLimit(
    "public.consignment",
    async () => new Response("{}", { status: 201 }),
    { repository: backend.repository, now: AT },
  );
  const first = await handler(requestWithIp());
  assert.equal(first.status, 201);
  const second = await handler(requestWithIp());
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("Retry-After"), "3600");
  const body = await second.json();
  assert.equal(body.error.code, "RATE_LIMITED");
});

test("las rutas públicas de mutación pasan por el limitador", async () => {
  const expectations = [
    ["app/api/v1/leads/route.ts", "public.lead"],
    ["app/api/v1/simulations/route.ts", "public.simulation"],
    ["app/api/v1/whatsapp/handoffs/route.ts", "public.handoff"],
    ["app/api/v1/appraisals/route.ts", "public.appraisal"],
    ["app/api/v1/appraisals/[code]/photos/route.ts", "public.appraisal-photo"],
    ["app/api/v1/affordability/search/route.ts", "public.search"],
    ["app/api/v1/consignments/route.ts", "public.consignment"],
    ["app/api/v1/consignments/[code]/photos/route.ts", "public.consignment-photo"],
  ];
  for (const [path, resource] of expectations) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /withRateLimit\(\s*"public\./, path);
    assert.ok(source.includes(`"${resource}"`), `${path} debe limitar ${resource}`);
  }

  // El contador vive en D1, no en memoria del Worker.
  const server = readFileSync("lib/server/rate-limit.ts", "utf8");
  assert.match(server, /D1RateLimitRepository/);
  assert.match(server, /RATE_LIMITED/);
  assert.match(server, /Retry-After/);
});
