import assert from "node:assert/strict";
import test from "node:test";

import {
  moneyFromMajor,
  moneyFromMinor,
  multiplyRatio,
} from "../lib/domain/index.mjs";

test("money parses and serializes ARS without floating point", () => {
  const amount = moneyFromMajor("12345678.91");
  assert.equal(amount.minorUnits, 1_234_567_891);
  assert.deepEqual(amount.toJSON(), {
    currency: "ARS",
    minorUnits: 1_234_567_891,
  });
  assert.throws(() => moneyFromMajor("10.999"), /at most two decimals/);
  assert.throws(() => moneyFromMajor(10.5), /decimal string or bigint/);
});

test("money arithmetic checks fixed units, currencies and safe range", () => {
  assert.equal(
    moneyFromMajor(10n).add(moneyFromMajor("2.50")).minorUnits,
    1_250,
  );
  assert.equal(moneyFromMajor(10n).subtract(moneyFromMajor(3n)).minorUnits, 700);
  assert.equal(multiplyRatio(moneyFromMinor(101), 1, 2).minorUnits, 51);
  assert.equal(multiplyRatio(moneyFromMinor(101), 1, 2, "down").minorUnits, 50);
  assert.throws(
    () => moneyFromMinor(Number.MAX_SAFE_INTEGER).add(moneyFromMinor(1)),
    /safe serialization range/,
  );
});
