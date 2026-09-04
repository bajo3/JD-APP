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

const { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } = await import("@aws-sdk/client-s3");
const { RemoteR2Error, RemoteR2ObjectStore } = await import("../lib/data/r2-remote.ts");

const config = {
  endpoint: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  bucket: "jda-uploads",
  accessKeyId: "test-access-key",
  secretAccessKey: "never-expose-this-test-secret",
};

function mockClient(send) {
  return { send };
}

test("remote R2 keeps stock and private metadata while never making a URL", async () => {
  const commands = [];
  const store = new RemoteR2ObjectStore({
    ...config,
    client: mockClient(async (command) => { commands.push(command); return {}; }),
  });

  const stockKey = await store.putStockImage({
    vehicleId: "vehicle-1", mediaId: "media-1", body: new ArrayBuffer(1), contentType: "image/webp", byteSize: 1, sha256: "stock-hash",
  });
  const privateKey = await store.putPrivateAppraisalImage({
    appraisalId: "appraisal-1", mediaId: "media-2", body: new ArrayBuffer(1), contentType: "image/jpeg", byteSize: 1, sha256: "private-hash",
  });

  assert.equal(stockKey, "public/stock/vehicle-1/media-1");
  assert.equal(privateKey, "private/appraisals/appraisal-1/media-2");
  assert.equal(commands.length, 2);
  assert.ok(commands[0] instanceof PutObjectCommand);
  assert.deepEqual(commands[0].input, {
    Bucket: "jda-uploads", Key: stockKey, Body: new Uint8Array([0]), ContentType: "image/webp",
    Metadata: { vehicleId: "vehicle-1", byteSize: "1", sha256: "stock-hash", visibility: "public" },
  });
  assert.equal(commands[1].input.Key, privateKey);
  assert.equal(commands[1].input.Metadata.visibility, "private");
  assert.equal("ACL" in commands[1].input, false);
});

test("remote R2 returns private bytes only through the caller-authorized object API", async () => {
  const bytes = new TextEncoder().encode("private image bytes");
  const stream = new Blob([bytes]).stream();
  const store = new RemoteR2ObjectStore({
    ...config,
    client: mockClient(async (command) => {
      assert.ok(command instanceof GetObjectCommand);
      return {
        Body: {
          transformToByteArray: async () => bytes,
          transformToString: async () => new TextDecoder().decode(bytes),
          transformToWebStream: () => stream,
        },
      };
    }),
  });

  const object = await store.getPrivateObject("private/appraisals/appraisal-1/media-2");
  assert.ok(object);
  assert.equal(object.bodyUsed, false);
  assert.equal(await object.text(), "private image bytes");
  assert.equal(object.bodyUsed, true);
  assert.throws(() => store.getPrivateObject("public/stock/vehicle-1/media-1"), /PRIVATE_OBJECT_KEY_REQUIRED/);
});

test("remote R2 returns null for a missing object and deletes through the same bucket", async () => {
  const commands = [];
  const store = new RemoteR2ObjectStore({
    ...config,
    client: mockClient(async (command) => {
      commands.push(command);
      if (command instanceof GetObjectCommand) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      return {};
    }),
  });

  assert.equal(await store.getStockObject("public/stock/vehicle-1/media-1"), null);
  await store.deleteObject("private/appraisals/appraisal-1/media-2");
  assert.ok(commands[1] instanceof DeleteObjectCommand);
  assert.deepEqual(commands[1].input, { Bucket: "jda-uploads", Key: "private/appraisals/appraisal-1/media-2" });
});

test("remote R2 fails closed without disclosing the secret or object key", async () => {
  const key = "private/appraisals/appraisal-1/media-2";
  const store = new RemoteR2ObjectStore({
    ...config,
    client: mockClient(async () => { throw new Error("provider detail"); }),
  });

  await assert.rejects(store.getPrivateObject(key), (error) => {
    assert.ok(error instanceof RemoteR2Error);
    assert.equal(error.code, "R2_REMOTE_REQUEST_FAILED");
    assert.equal(error.message.includes(config.secretAccessKey), false);
    assert.equal(error.message.includes(key), false);
    return true;
  });
  assert.throws(
    () => new RemoteR2ObjectStore({ ...config, endpoint: "http://not-secure.example", client: mockClient(async () => ({})) }),
    (error) => error instanceof RemoteR2Error && error.code === "R2_REMOTE_CONFIG_INVALID",
  );
});
