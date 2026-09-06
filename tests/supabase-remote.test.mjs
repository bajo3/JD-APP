import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const relative = specifier.slice(2);
      return {
        url: pathToFileURL(resolve(
          projectRoot,
          specifier === "@/db" ? "db/index.ts" : relative.endsWith(".mjs") ? relative : `${relative}.ts`,
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

const { SupabaseD1Database, RemoteSupabaseError } = await import("../db/supabase-remote.ts");
const { D1RateLimitRepository } = await import("../lib/data/rate-limit-repository.ts");

const connectionString = process.env.SUPABASE_DB_URL;
const skip = !connectionString;
if (skip) {
  console.warn("SUPABASE_DB_URL no está configurada: se omiten las pruebas de supabase-remote.ts.");
}

function suite(name, fn) {
  test(name, { skip }, fn);
}

async function withTempTable(database, run) {
  const table = `t_${crypto.randomUUID().replace(/-/g, "")}`;
  await database.exec(
    `CREATE TABLE ${table} (id text primary key, status text not null, changed_by text)`,
  );
  try {
    await run(table);
  } finally {
    await database.exec(`DROP TABLE IF EXISTS ${table}`);
  }
}

suite("traduce placeholders posicionales y lee resultados con forma D1", async () => {
  const database = new SupabaseD1Database({ connectionString });
  try {
    await withTempTable(database, async (table) => {
      await database
        .prepare(`INSERT INTO ${table} (id, status) VALUES (?, ?)`)
        .bind("row-1", "OPEN")
        .run();
      const row = await database
        .prepare(`SELECT id, status FROM ${table} WHERE id = ?`)
        .bind("row-1")
        .first();
      assert.deepEqual(row, { id: "row-1", status: "OPEN" });
      assert.equal(await database.prepare(`SELECT status FROM ${table} WHERE id = ?`).bind("row-1").first("status"), "OPEN");
    });
  } finally {
    await database.close();
  }
});

suite("dentro de un batch, changes() refleja las filas que tocó la sentencia anterior", async () => {
  const database = new SupabaseD1Database({ connectionString });
  try {
    await withTempTable(database, async (table) => {
      await database.prepare(`INSERT INTO ${table} (id, status) VALUES ('row-1', 'OPEN')`).run();

      // La actualización coincide: la sentencia dependiente debe escribir.
      const [update, audit] = await database.batch([
        database.prepare(`UPDATE ${table} SET status = ? WHERE id = ? AND status = ?`).bind("CLOSED", "row-1", "OPEN"),
        database
          .prepare(`INSERT INTO ${table} (id, status, changed_by) SELECT ?, ?, ? WHERE changes() > 0`)
          .bind("audit-1", "AUDIT", "seller@jda.test"),
      ]);
      assert.equal(update.meta.changes, 1);
      assert.equal(audit.meta.changes, 1);
      const auditRow = await database.prepare(`SELECT changed_by FROM ${table} WHERE id = ?`).bind("audit-1").first();
      assert.deepEqual(auditRow, { changed_by: "seller@jda.test" });

      // Reintentar la misma condición ya no coincide (el estado ya cambió):
      // la sentencia dependiente no debe escribir nada.
      const [update2, audit2] = await database.batch([
        database.prepare(`UPDATE ${table} SET status = ? WHERE id = ? AND status = ?`).bind("CLOSED", "row-1", "OPEN"),
        database
          .prepare(`INSERT INTO ${table} (id, status, changed_by) SELECT ?, ?, ? WHERE changes() > 0`)
          .bind("audit-2", "AUDIT", "seller@jda.test"),
      ]);
      assert.equal(update2.meta.changes, 0);
      assert.equal(audit2.meta.changes, 0);
      const missingAudit = await database.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind("audit-2").first();
      assert.equal(missingAudit, null);
    });
  } finally {
    await database.close();
  }
});

suite("un batch es atómico: una sentencia que falla revierte todo el lote", async () => {
  const database = new SupabaseD1Database({ connectionString });
  try {
    await withTempTable(database, async (table) => {
      await assert.rejects(
        database.batch([
          database.prepare(`INSERT INTO ${table} (id, status) VALUES ('row-1', 'OPEN')`),
          database.prepare(`INSERT INTO ${table} (id, status) VALUES ('row-1', 'DUPLICATE')`), // choca con la primary key
        ]),
        (error) => error instanceof RemoteSupabaseError && error.code === "SUPABASE_REMOTE_REQUEST_FAILED",
      );
      const row = await database.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind("row-1").first();
      assert.equal(row, null, "la primera sentencia del lote fallido no debería haber quedado escrita");
    });
  } finally {
    await database.close();
  }
});

suite("una configuración vacía falla cerrado sin conectar", () => {
  assert.throws(
    () => new SupabaseD1Database({ connectionString: "" }),
    (error) => error instanceof RemoteSupabaseError && error.code === "SUPABASE_REMOTE_CONFIG_INVALID",
  );
});

// Encontrado el 2026-09-06 al crear una cuenta real: Postgres considera
// ambigua una referencia a "hits" sin calificar dentro de ON CONFLICT DO
// UPDATE SET cuando el valor depende de la fila existente (a diferencia de
// excluded.columna, que nunca es ambiguo). SQLite nunca tuvo este problema,
// así que tests/rate-limit.test.mjs (contra fixtures) no lo detectó.
suite("el contador de rate limit incrementa contra Postgres real sin ambigüedad de columna", async () => {
  const database = new SupabaseD1Database({ connectionString });
  const repository = new D1RateLimitRepository(database);
  const key = `t_rate_${crypto.randomUUID().replace(/-/g, "")}`;
  try {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const first = await repository.hit({ key, resource: "public.account", expiresAt });
    assert.deepEqual(first, { hits: 1 });
    const second = await repository.hit({ key, resource: "public.account", expiresAt });
    assert.deepEqual(second, { hits: 2 });
  } finally {
    await database.exec(`DELETE FROM rate_limit_window WHERE key = '${key}'`);
    await database.close();
  }
});
