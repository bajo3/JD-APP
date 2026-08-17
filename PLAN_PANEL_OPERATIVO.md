# Panel Operativo JDA — Iteración siguiente

**Estado:** implementado y validado para publicación.

## Objetivo

Convertir el panel interno de demostración en la herramienta mínima con la que Jesús Díaz Automotores puede operar la V1 sin modificar código ni tocar la base de datos manualmente.

Esta iteración no agrega otra idea “BOOM”. Cierra el circuito de las seis capacidades ya publicadas: stock, tasación, cálculo de alcance, simulación, WhatsApp contextual y Oferta JD del Día.

## Alcance congelado

1. Resumen operativo con métricas calculadas desde D1.
2. Stock: alta, edición, publicación, pausa y archivo lógico.
3. Leads: bandeja, asignación y cambio de etapa con historial.
4. Tasaciones: revisión humana, rango, certeza, vigencia y observaciones.
5. Financiación: versiones de tarifarios, tramos y publicación controlada.
6. Ofertas: borrador, programación, publicación y pausa.
7. Auditoría atribuida al usuario interno para todas las mutaciones.

## Fuera de alcance

- Borrado físico de registros.
- Importación automática desde un proveedor de stock todavía no confirmado.
- Tasación automática con fuentes externas no confirmadas.
- Cobro de señas.
- Envíos masivos por WhatsApp o push.
- CRM externo, hasta confirmar si JDA ya utiliza uno.
- Condiciones comerciales reales inventadas.

## Seguridad

- El panel conserva Sign in with ChatGPT y una allowlist de correos del negocio.
- Todas las lecturas y escrituras administrativas vuelven a autorizar en el servidor.
- Las APIs públicas existentes no adquieren permisos administrativos.
- El panel falla cerrado si falta la allowlist.
- Ningún mensaje de error expone la lista de usuarios autorizados.

## Reglas transversales

- Cada edición lleva `expectedVersion`; una edición sobre datos viejos devuelve conflicto y obliga a recargar.
- Cada alta acepta `Idempotency-Key` para evitar duplicados.
- Toda mutación registra actor, entidad, acción, versión anterior/nueva, fecha y un resumen seguro.
- Los importes se transportan como enteros en centavos ARS.
- Las fechas se evalúan con reloj del servidor y se guardan en UTC.
- Los datos DEMO continúan identificados como DEMO.

## Estados mínimos

### Stock

`DRAFT → AVAILABLE → RESERVED | SOLD | PAUSED → ARCHIVED`

No se permite publicar una unidad sin precio, año, kilometraje y datos básicos válidos. Reservada, vendida o archivada no vuelve a aparecer como disponible por una edición accidental.

### Leads

`NEW → CONTACTED → QUALIFIED → WON | LOST`

Una pérdida requiere motivo. Una venta ganada conserva la simulación y el contexto que la originaron.

### Tasaciones

`SUBMITTED → IN_REVIEW → ESTIMATED → APPROVED | REJECTED | EXPIRED`

Una estimación exige rango `low ≤ base ≤ high`, nivel de certeza y vigencia futura.

### Tarifarios

`DRAFT → PUBLISHED → RETIRED`

Publicar crea una versión inmutable de condiciones y tramos. La edición posterior genera otra versión; no reescribe una simulación histórica.

### Ofertas

`DRAFT → SCHEDULED → ACTIVE → PAUSED | EXPIRED | ARCHIVED`

Una oferta activa exige unidad disponible, ventana válida y snapshot explícito de condiciones normales.

## Superficies

- `/panel` — resumen y pendientes.
- `/panel/stock` — inventario y formulario.
- `/panel/leads` — pipeline y seguimiento.
- `/panel/tasaciones` — revisión y decisión.
- `/panel/financiacion` — versiones y tramos.
- `/panel/ofertas` — calendario y estado.
- `/api/v1/admin/**` — contratos protegidos reutilizables por una futura app interna.

## Criterios de salida

- Ninguna métrica visible está escrita a mano.
- Se puede crear y publicar una unidad DEMO desde el panel.
- Dos ediciones concurrentes no se pisan silenciosamente.
- Un cambio de precio crea historial.
- Una tasación queda auditada con actor y vigencia.
- Un tarifario publicado puede alimentar el motor sin alterar snapshots anteriores.
- Una oferta pausada deja de aplicarse inmediatamente.
- Todas las rutas administrativas rechazan usuarios sin autorización.
- Build, tipos, lint, migración y pruebas pasan antes de publicar.
