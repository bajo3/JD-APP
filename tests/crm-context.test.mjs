import assert from "node:assert/strict";
import test from "node:test";

import {
  CrmContractError,
  fingerprintContextualLeadCommand,
  normalizeContextualLeadContext,
  validateContextualConversion,
} from "../lib/crm/index.mjs";

const simulation = Object.freeze({
  id: "simulation-1",
  publicCode: "JD-ABC123",
  leadId: null,
  vehicleId: "vehicle-1",
  promotionId: "promotion-1",
});
const vehicle = Object.freeze({ id: "vehicle-1", slug: "toyota-corolla-xei-2022" });

test("el contexto opcional se normaliza sin aceptar pares incompletos", () => {
  assert.equal(normalizeContextualLeadContext({}), null);
  const normalized = normalizeContextualLeadContext({
    simulationCode: " jd-abc123 ",
    vehicleSlug: " Toyota-Corolla-XEI-2022 ",
  });
  assert.deepEqual(normalized, {
    simulationCode: "JD-ABC123",
    vehicleSlug: "toyota-corolla-xei-2022",
  });
  assert.ok(Object.isFrozen(normalized));
  assert.throws(
    () => normalizeContextualLeadContext({ simulationCode: "JD-ABC123" }),
    (error) =>
      error instanceof CrmContractError &&
      error.code === "CRM_INVALID_CONTEXT" &&
      error.field === "vehicleSlug",
  );
});

test("la validación vincula exclusivamente lead, simulación y unidad autoritativos", () => {
  const link = validateContextualConversion({
    leadId: "lead-1",
    simulationCode: "JD-ABC123",
    vehicleSlug: "toyota-corolla-xei-2022",
    simulation,
    vehicle,
  });
  assert.deepEqual(link, {
    schemaVersion: "jda-crm.v1",
    leadId: "lead-1",
    simulationId: "simulation-1",
    simulationCode: "JD-ABC123",
    vehicleId: "vehicle-1",
    vehicleSlug: "toyota-corolla-xei-2022",
    promotionId: "promotion-1",
  });
  assert.ok(Object.isFrozen(link));
});

test("mismatches de código, slug, unidad y dueño usan errores estables", () => {
  const base = {
    leadId: "lead-1",
    simulationCode: "JD-ABC123",
    vehicleSlug: "toyota-corolla-xei-2022",
    simulation,
    vehicle,
  };
  const cases = [
    [{ ...base, simulationCode: "JD-OTHER1" }, "CRM_SIMULATION_CODE_MISMATCH"],
    [{ ...base, vehicleSlug: "otra-unidad-2022" }, "CRM_VEHICLE_SLUG_MISMATCH"],
    [{ ...base, simulation: { ...simulation, vehicleId: "vehicle-2" } }, "CRM_SIMULATION_VEHICLE_MISMATCH"],
    [{ ...base, simulation: { ...simulation, leadId: "lead-2" } }, "CRM_SIMULATION_ALREADY_LINKED"],
  ];
  for (const [input, code] of cases) {
    assert.throws(
      () => validateContextualConversion(input),
      (error) => error instanceof CrmContractError && error.code === code,
    );
  }
  assert.doesNotThrow(() =>
    validateContextualConversion({
      ...base,
      simulation: { ...simulation, leadId: "lead-1" },
    }),
  );
});

test("el fingerprint es canónico y separa el contexto libre de PII", async () => {
  const input = {
    identity: { name: "Martín González", phoneNormalized: "+5492494587046" },
    command: {
      contactConsent: true,
      source: "AFFORDABILITY_WEB",
      simulationCode: "JD-ABC123",
      vehicleSlug: "toyota-corolla-xei-2022",
    },
  };
  const first = await fingerprintContextualLeadCommand(input);
  const reordered = await fingerprintContextualLeadCommand({
    command: {
      vehicleSlug: input.command.vehicleSlug,
      simulationCode: input.command.simulationCode,
      source: input.command.source,
      contactConsent: true,
    },
    identity: {
      phoneNormalized: input.identity.phoneNormalized,
      name: input.identity.name,
    },
  });
  assert.deepEqual(first, reordered);
  assert.match(first.commandHash, /^[a-f0-9]{64}$/);
  assert.match(first.contextHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(first));
  assert.doesNotMatch(JSON.stringify(first), /Martín|4587046/);

  const anotherPerson = await fingerprintContextualLeadCommand({
    ...input,
    identity: { name: "Otra Persona", phoneNormalized: "+5492494000000" },
  });
  assert.equal(first.contextHash, anotherPerson.contextHash);
  assert.notEqual(first.commandHash, anotherPerson.commandHash);

  const anotherVehicle = await fingerprintContextualLeadCommand({
    ...input,
    command: { ...input.command, vehicleSlug: "volkswagen-t-cross-2022" },
  });
  assert.notEqual(first.contextHash, anotherVehicle.contextHash);
  assert.notEqual(first.commandHash, anotherVehicle.commandHash);
});

test("el fingerprint exige consentimiento y PII previamente normalizada", async () => {
  await assert.rejects(
    () => fingerprintContextualLeadCommand({
      identity: { name: "Cliente", phoneNormalized: "teléfono" },
      command: {
        contactConsent: false,
        source: "AFFORDABILITY_WEB",
        simulationCode: "JD-ABC123",
        vehicleSlug: "toyota-corolla-xei-2022",
      },
    }),
    (error) => error instanceof CrmContractError && error.code === "CRM_INVALID_CONTEXT",
  );
});
