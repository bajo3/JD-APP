const SUPPORTED_CURRENCIES = new Set(["ARS"]);

function assertCurrency(currency) {
  if (!SUPPORTED_CURRENCIES.has(currency)) {
    throw new RangeError(`Unsupported currency: ${currency}`);
  }
}

function asSafeMinorUnits(value) {
  const minorUnits = typeof value === "bigint" ? value : BigInt(value);
  if (
    minorUnits > BigInt(Number.MAX_SAFE_INTEGER) ||
    minorUnits < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new RangeError("Money exceeds the safe serialization range");
  }
  return Number(minorUnits);
}

function divide(numerator, denominator, rounding = "half-up") {
  if (denominator <= 0n) {
    throw new RangeError("Denominator must be positive");
  }

  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;

  if (rounding === "down") return sign * quotient;
  if (rounding === "up") {
    return sign * (quotient + (remainder === 0n ? 0n : 1n));
  }
  if (rounding !== "half-up") {
    throw new RangeError(`Unsupported rounding mode: ${rounding}`);
  }

  return sign * (quotient + (remainder * 2n >= denominator ? 1n : 0n));
}

/**
 * Immutable fixed-decimal money. Values are stored as safe integer centavos;
 * every multiplication and division uses BigInt before returning to the safe
 * serialization range.
 */
export class Money {
  #minorUnits;

  constructor(minorUnits, currency = "ARS") {
    assertCurrency(currency);
    if (
      (typeof minorUnits !== "number" && typeof minorUnits !== "bigint") ||
      (typeof minorUnits === "number" && !Number.isSafeInteger(minorUnits))
    ) {
      throw new TypeError("Money minor units must be a safe integer");
    }

    this.#minorUnits = asSafeMinorUnits(minorUnits);
    this.currency = currency;
    Object.freeze(this);
  }

  get minorUnits() {
    return this.#minorUnits;
  }

  add(other) {
    assertSameCurrency(this, other);
    return new Money(
      asSafeMinorUnits(BigInt(this.#minorUnits) + BigInt(other.#minorUnits)),
      this.currency,
    );
  }

  subtract(other) {
    assertSameCurrency(this, other);
    return new Money(
      asSafeMinorUnits(BigInt(this.#minorUnits) - BigInt(other.#minorUnits)),
      this.currency,
    );
  }

  max(other) {
    assertSameCurrency(this, other);
    return this.#minorUnits >= other.#minorUnits ? this : other;
  }

  min(other) {
    assertSameCurrency(this, other);
    return this.#minorUnits <= other.#minorUnits ? this : other;
  }

  isNegative() {
    return this.#minorUnits < 0;
  }

  isZero() {
    return this.#minorUnits === 0;
  }

  equals(other) {
    return (
      other instanceof Money &&
      this.currency === other.currency &&
      this.#minorUnits === other.#minorUnits
    );
  }

  toJSON() {
    return { currency: this.currency, minorUnits: this.#minorUnits };
  }
}

export function moneyFromMinor(minorUnits, currency = "ARS") {
  return new Money(minorUnits, currency);
}

export function moneyFromMajor(value, currency = "ARS") {
  assertCurrency(currency);
  const text = typeof value === "bigint" ? value.toString() : value;
  if (typeof text !== "string" || !/^-?\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new TypeError(
      "Major money must be a decimal string or bigint with at most two decimals",
    );
  }

  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [major, decimal = ""] = unsigned.split(".");
  const minor = BigInt(major) * 100n + BigInt(decimal.padEnd(2, "0"));
  return new Money(negative ? -minor : minor, currency);
}

export function zeroMoney(currency = "ARS") {
  return new Money(0, currency);
}

export function sumMoney(values, currency = "ARS") {
  return values.reduce((total, value) => total.add(value), zeroMoney(currency));
}

export function multiplyRatio(
  amount,
  numerator,
  denominator,
  rounding = "half-up",
) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new TypeError("Ratio parts must be safe integers");
  }
  return new Money(
    asSafeMinorUnits(
      divide(
        BigInt(amount.minorUnits) * BigInt(numerator),
        BigInt(denominator),
        rounding,
      ),
    ),
    amount.currency,
  );
}

export function compareMoney(left, right) {
  assertSameCurrency(left, right);
  return Math.sign(left.minorUnits - right.minorUnits);
}

export function assertNonNegativeMoney(value, fieldName) {
  if (!(value instanceof Money)) {
    throw new TypeError(`${fieldName} must be Money`);
  }
  if (value.isNegative()) {
    throw new RangeError(`${fieldName} cannot be negative`);
  }
}

export function assertSameCurrency(...values) {
  const moneyValues = values.filter((value) => value instanceof Money);
  if (moneyValues.length !== values.length) {
    throw new TypeError("Expected Money values");
  }
  const [first] = moneyValues;
  if (moneyValues.some((value) => value.currency !== first.currency)) {
    throw new RangeError("Cannot operate on different currencies");
  }
}

export const internalMoneyMath = Object.freeze({ divide, asSafeMinorUnits });
