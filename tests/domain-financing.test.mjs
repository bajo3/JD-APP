import assert from "node:assert/strict";
import test from "node:test";

import {
  fixturePlans,
  moneyFromMajor,
  quoteFrench,
  quoteInstallment,
} from "../lib/domain/index.mjs";

test("French system handles zero and non-zero rates deterministically", () => {
  const principal = moneyFromMajor(12_000_000n);
  assert.equal(quoteFrench(principal, 0, 12).minorUnits, 100_000_000);
  assert.equal(quoteFrench(principal, 220, 12).minorUnits, 114_869_862);
  assert.deepEqual(
    quoteFrench(principal, 220, 12),
    quoteFrench(principal, 220, 12),
  );
});

test("coefficient plans calculate cuota and total using fixed integers", () => {
  const plan = fixturePlans.find((candidate) => candidate.id === "plan-coeficiente-36");
  const quote = quoteInstallment(moneyFromMajor(10_000_000n), plan, 36);
  assert.equal(quote.installment.minorUnits, 47_850_000);
  assert.equal(quote.totalRepayment.minorUnits, 1_722_600_000);
  assert.throws(() => quoteInstallment(moneyFromMajor(10_000_000n), plan, 24));
});

test("provider table selects the exact term and principal band", () => {
  const plan = {
    id: "table",
    version: "1",
    allowedTerms: [12],
    pricing: {
      kind: "table",
      rows: [
        {
          termMonths: 12,
          fromAmount: moneyFromMajor(1_000_000n),
          toAmount: moneyFromMajor(5_000_000n),
          installmentCoefficientPpm: 95_000,
        },
      ],
    },
  };
  assert.equal(
    quoteInstallment(moneyFromMajor(4_000_000n), plan, 12).installment
      .minorUnits,
    38_000_000,
  );
  assert.throws(
    () => quoteInstallment(moneyFromMajor(6_000_000n), plan, 12),
    /no row/,
  );
});
