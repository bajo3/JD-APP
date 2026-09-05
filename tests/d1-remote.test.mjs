import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { RemoteD1Database, RemoteD1Error } = await import("../db/d1-remote.ts");

const config = {
  accountId: "0123456789abcdef0123456789abcdef",
  databaseId: "12345678-1234-4234-9234-123456789abc",
  apiToken: "never-expose-this-test-token",
};

function successfulResponse(result) {
  return new Response(JSON.stringify({ success: true, result }), { status: 200 });
}

test("remote D1 preserves prepared bindings and reads D1-shaped results", async () => {
  const calls = [];
  const database = new RemoteD1Database({
    ...config,
    async fetch(url, init) {
      calls.push({ url: String(url), init });
      return successfulResponse([{ success: true, results: [{ id: "vehicle-1", total: 3 }], meta: { duration: 1 } }]);
    },
  });

  const statement = database.prepare("SELECT id, total FROM vehicle WHERE id = ?").bind("vehicle-1");
  assert.deepEqual(await statement.first(), { id: "vehicle-1", total: 3 });
  assert.equal(await statement.first("total"), 3);

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/accounts\/0123456789abcdef0123456789abcdef\/d1\/database\/12345678-1234-4234-9234-123456789abc\/query$/);
  assert.equal(calls[0].init.headers.Authorization, "Bearer never-expose-this-test-token");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    sql: "SELECT id, total FROM vehicle WHERE id = ?",
    params: ["vehicle-1"],
  });
});

test("remote D1 sends one batch and keeps each result in order", async () => {
  let body;
  const database = new RemoteD1Database({
    ...config,
    async fetch(_url, init) {
      body = JSON.parse(init.body);
      return successfulResponse([
        { success: true, results: [], meta: { changes: 1 } },
        { success: true, results: [{ total: 1 }], meta: {} },
      ]);
    },
  });

  const [changed, selected] = await database.batch([
    database.prepare("UPDATE vehicle SET status = ? WHERE id = ?").bind("PAUSED", "vehicle-1"),
    database.prepare("SELECT count(*) AS total FROM vehicle").bind(),
  ]);
  assert.deepEqual(body, {
    batch: [
      { sql: "UPDATE vehicle SET status = ? WHERE id = ?", params: ["PAUSED", "vehicle-1"] },
      { sql: "SELECT count(*) AS total FROM vehicle", params: [] },
    ],
  });
  assert.equal(changed.meta.changes, 1);
  assert.deepEqual(selected.results, [{ total: 1 }]);
});

test("remote D1 fails closed without returning query details or credentials", async () => {
  const database = new RemoteD1Database({
    ...config,
    async fetch() {
      return new Response(JSON.stringify({ success: false, errors: [{ message: "sensitive provider detail" }] }), { status: 403 });
    },
  });

  await assert.rejects(
    database.prepare("SELECT secret FROM table").all(),
    (error) => {
      assert.ok(error instanceof RemoteD1Error);
      assert.equal(error.code, "D1_REMOTE_REQUEST_FAILED");
      assert.equal(error.message.includes(config.apiToken), false);
      assert.equal(error.message.includes("SELECT secret"), false);
      return true;
    },
  );
});

test("remote D1 rejects unsafe bindings and statements from another database", async () => {
  const database = new RemoteD1Database({ ...config, async fetch() { return successfulResponse([]); } });
  assert.throws(
    () => database.prepare("SELECT ?").bind(undefined),
    (error) => error instanceof RemoteD1Error && error.code === "D1_REMOTE_CONFIG_INVALID",
  );
  const other = new RemoteD1Database({ ...config, databaseId: "87654321-4321-4234-9234-cba987654321", async fetch() { return successfulResponse([]); } });
  await assert.rejects(
    database.batch([other.prepare("SELECT 1")]),
    (error) => error instanceof RemoteD1Error && error.code === "D1_REMOTE_CONFIG_INVALID",
  );
});

test("remote D1 rejects incomplete envelopes and never fabricates success", async () => {
  const malformed = [
    {},
    { success: false, result: [{ success: true, results: [], meta: {} }] },
    { success: true, result: [] },
    { success: true, result: [null] },
    { success: true, result: ["result"] },
    { success: true, result: [{ success: true, results: [], meta: null }] },
    { success: true, result: [{ success: true, results: null, meta: {} }] },
  ];
  for (const payload of malformed) {
    const database = new RemoteD1Database({
      ...config,
      async fetch() { return new Response(JSON.stringify(payload), { status: 200 }); },
    });
    await assert.rejects(
      database.prepare("SELECT 1").all(),
      (error) => error instanceof RemoteD1Error && error.code === "D1_REMOTE_REQUEST_FAILED",
    );
  }
});

test("remote D1 enforces response cardinality and avoids a network call for an empty batch", async () => {
  let calls = 0;
  const database = new RemoteD1Database({
    ...config,
    async fetch() {
      calls += 1;
      return successfulResponse([{ success: true, results: [], meta: {} }]);
    },
  });
  assert.deepEqual(await database.batch([]), []);
  assert.equal(calls, 0);

  const oneWithTwo = new RemoteD1Database({
    ...config,
    async fetch() {
      return successfulResponse([
        { success: true, results: [], meta: {} },
        { success: true, results: [], meta: {} },
      ]);
    },
  });
  await assert.rejects(
    oneWithTwo.prepare("UPDATE vehicle SET status = 'PAUSED'").run(),
    (error) => error instanceof RemoteD1Error && error.code === "D1_REMOTE_REQUEST_FAILED",
  );

  const twoWithOne = new RemoteD1Database({
    ...config,
    async fetch() {
      return successfulResponse([{ success: true, results: [], meta: {} }]);
    },
  });
  await assert.rejects(
    twoWithOne.batch([twoWithOne.prepare("SELECT 1"), twoWithOne.prepare("SELECT 2")]),
    (error) => error instanceof RemoteD1Error && error.code === "D1_REMOTE_REQUEST_FAILED",
  );
});

test("remote D1 accepts optional results/meta and preserves multi-statement exec", async () => {
  const database = new RemoteD1Database({
    ...config,
    async fetch(_url, init) {
      const body = JSON.parse(init.body);
      if (body.sql) {
        return successfulResponse([
          { success: true },
          { success: true, results: [{ changed: 1 }] },
        ]);
      }
      return successfulResponse([{ success: true }]);
    },
  });
  const result = await database.exec("CREATE TABLE a (id INTEGER); INSERT INTO a VALUES (1);");
  assert.deepEqual(result.results, []);
  assert.deepEqual(result.meta, {});
});
