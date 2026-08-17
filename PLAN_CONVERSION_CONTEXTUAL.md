# Conversión contextual: unidad → operación → CRM

## Objetivo

Cerrar la promesa central de la V1: una intención por una unidad debe atravesar
el motor de accesibilidad, persistir una simulación inmutable y llegar al
vendedor con el contexto completo. El CRM no puede reducir una operación a
“consulta general”.

## Alcance congelado

- La ficha y la Oferta JD ofrecen **Simular esta unidad** como CTA principal.
- `/que-auto-me-llevo?vehiculo=<slug>` valida el slug contra stock `AVAILABLE`
  en el servidor; el query nunca aporta precio, ID ni desglose.
- El vehículo contextual se identifica y prioriza entre resultados emitidos y
  firmados por el backend. Si ya no aparece, se explica y se conservan
  alternativas.
- `POST /api/v1/leads` acepta contexto opcional `simulationCode` y
  `vehicleSlug`.
- Para una operación contextual se valida que simulación, vehículo y snapshot
  coincidan exactamente.
- Lead, consentimiento, vínculo de simulación y `lead_interest` se persisten en
  una operación D1 idempotente.
- La misma clave con el mismo comando reproduce el resultado; la misma clave
  con otro comando devuelve `409 IDEMPOTENCY_CONFLICT` sin escrituras nuevas.
- El contexto queda guardado aunque WhatsApp no esté configurado.
- El handoff contextual solo acepta una simulación ya vinculada a ese lead y
  vehículo.
- `/panel/leads` muestra unidad y código reales.
- `/panel/leads/[id]` protegido muestra el snapshot guardado, su vigencia,
  disclaimer y eventos; nunca recalcula condiciones históricas.

## Snapshot visible al vendedor

- Cliente, teléfono, origen y estado.
- Vehículo y código de simulación.
- Precio publicado y precio efectivo.
- Usado aplicado y bonificación de toma.
- Efectivo, saldo financiado, plazo, cuota y costo total.
- Clasificación, creación, vencimiento y estado de vigencia.
- Disclaimer congelado.
- Evento de handoff de WhatsApp, si existe.

## Persistencia

- `lead.create_request_hash` conserva el fingerprint del comando de alta.
- `lead_interest` obtiene unicidad por lead, tipo y simulación.
- `simulation.lead_id` se vincula al mismo lead dentro de la operación.
- `lead_interest.context_json` contiene únicamente contexto comercial
  JSON-safe; la fuente financiera sigue siendo el snapshot de `simulation`.

## Seguridad e invariantes

- El slug de URL es solo una preferencia; el servidor resuelve la unidad.
- Una simulación no puede vincularse a dos leads.
- Un `vehicleSlug` diferente al `vehicle_id` de la simulación falla sin
  escrituras.
- Las páginas y lecturas del panel vuelven a autorizar en servidor y fallan
  cerradas.
- El detalle administrativo usa datos persistidos; no consulta nuevamente el
  motor, precio, promoción ni tarifario.
- Ninguna ruta expone notas internas, hashes de idempotencia o PII fuera del
  panel protegido.

## Contratos públicos

`POST /api/v1/leads` mantiene el contrato existente y admite:

```json
{
  "name": "...",
  "phone": "...",
  "contactConsent": true,
  "source": "AFFORDABILITY_WEB",
  "simulationCode": "SIM-...",
  "vehicleSlug": "..."
}
```

El handoff contextual recibe `leadId`, `simulationCode` y `vehicleSlug`, pero
solo genera el enlace cuando el vínculo ya existe.

## Criterios de salida

- Ficha/oferta → finder contextual → simulación → lead → handoff produce un
  solo lead, consentimiento, interés y evento.
- El panel muestra los mismos importes del snapshot seleccionado.
- Replays no duplican filas ni eventos.
- Payload conflictivo, vehículo incompatible o simulación ligada a otro lead
  fallan sin escritura parcial.
- Sin WhatsApp configurado, el lead y su operación siguen visibles en CRM.
- Slug inválido o no disponible abre el finder genérico sin confiar en el
  cliente.
- Tests, migración, tipos, lint, build y E2E D1/Workers pasan antes de publicar.

## Fuera de alcance

- Fotos privadas de tasación.
- Página pública compartible de simulación.
- WhatsApp Business y mensajes automáticos.
- Scoring, IA, push y automatizaciones.
- Notas comerciales avanzadas.
- Cambios al motor financiero.
