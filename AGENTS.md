# Instrucciones para Codex — Jesús Díaz Automotores

## Misión

Trabajá activamente hasta convertir este repositorio en una candidata a
producción verificable. No te limites a analizar, proponer o escribir otro
plan: inspeccioná el estado real, implementá, probá, corregí, integrá y dejá
cada corte terminado.

El objetivo completo y sus condiciones de cierre están en
`GOAL_JDA_CANDIDATA_PRODUCCION.md`. Leelo entero antes de modificar código y
usalo como fuente principal de alcance.

## Producto que hay que proteger

La propuesta central es:

> usado + efectivo + cuota = qué auto te podés llevar hoy

La V1 prioriza:

1. stock disponible y honesto;
2. tasación preliminar;
3. buscador de autos alcanzables;
4. simulación congelada;
5. WhatsApp + CRM con contexto;
6. Oferta JD del Día.

No agregues nuevas features. Consignación virtual es V1.1/opcional hasta que
quede técnicamente cerrada y JDA confirme su operación comercial.

## Estado inicial que debés preservar

- Existe trabajo local sin commit de consignación virtual. No lo borres, no
  uses reset/checkout destructivo y no descartes cambios que no hayas creado.
- La última versión publicada está detrás del código local. No publiques hasta
  integrar y validar el estado completo.
- El proyecto usa Next App Router, Vinext, Cloudflare Workers, D1, R2, Drizzle y
  OpenAI Sites. Conservá esa arquitectura.
- `.openai/hosting.json` sólo guarda bindings lógicos y el project ID. Los
  valores del entorno se administran en Sites.
- Los datos demo deben seguir marcados como DEMO. No inventes stock, tasas,
  teléfonos, emails, condiciones, legales ni identidad de marca.

## Primera tarea obligatoria

Cerrá los cuatro riesgos críticos de la consignación actualmente en progreso:

1. reemplazar la autorización por código público con un upload token aleatorio
   fuerte, guardado solamente como SHA-256;
2. hacer atómica e idempotente la creación de lead, consentimiento y
   consignación, con claves estables durante reintentos;
3. implementar un ciclo recuperable `PENDING → READY | FAILED → ARCHIVED` para
   fotos D1/R2, sin éxitos falsos ni objetos accesibles incompletos;
4. corregir la migración 0008 y su snapshot para que `npm run db:generate` no
   produzca una migración duplicada.

No empieces otra mejora hasta que esos cuatro puntos tengan pruebas y evidencia
en D1/R2 real con Wrangler.

## Forma de trabajar

1. Leé primero `GOAL_JDA_CANDIDATA_PRODUCCION.md`, `PLAN_MAESTRO_V1.md`,
   `PUERTAS_DE_SALIDA.md`, `README.md`, el diff actual y las instrucciones de
   cualquier skill aplicable.
2. Inspeccioná el worktree antes de editar. Tratá todos los cambios existentes
   como trabajo que se debe preservar.
3. Mantené un plan corto y actualizado. Una sola tarea puede estar en progreso.
4. Cerrá una vertical completa por vez: contrato → persistencia → API → UI →
   pruebas → Worker real → commit.
5. Usá `apply_patch` para editar archivos. No hagas reescrituras destructivas.
6. Si encontrás una contradicción, resolvela con evidencia del código, D1, Sites
   o una decisión confirmada. No elijas silenciosamente la respuesta cómoda.
7. Si falta un dato de JDA, avanzá hasta la frontera segura, registrá una
   pregunta concreta en `DECISIONES_JDA.md` y mantené la función deshabilitada o
   marcada como DEMO.
8. No declares una fase lista porque una prueba estrecha pasa. Verificá el
   recorrido completo afectado.
9. Creá commits pequeños y coherentes sólo después de la validación. No incluyas
   cambios ajenos fuera de la vertical.
10. El agente principal es el único autorizado a empaquetar y publicar Sites.

## División Sol / Luna

### Sol

Usá Sol para:

- contratos e invariantes;
- seguridad y autorización;
- dinero y reglas comerciales;
- esquema, migraciones y repositorios;
- transacciones, idempotencia y concurrencia;
- D1/R2, compensación y reconciliación;
- rate limiting, auditoría, backup y restauración;
- pruebas de integración y Worker real.

### Luna

Usá Luna después de congelar los contratos para:

- formularios y componentes;
- estados loading/error/empty/stale/retry;
- accesibilidad, teclado y responsive;
- microcopy honesto;
- previews de archivos y cleanup de object URLs;
- recorridos visuales y pruebas de UI.

Luna no modifica migraciones, permisos, estados de negocio, fórmulas ni dinero.

### Coordinación

- Definí archivos de propiedad exclusiva para cada tarea paralela.
- No permitas que dos agentes editen la misma capa simultáneamente.
- Revisá personalmente los contratos y las instrucciones; no delegues su
  interpretación.
- Integrá sólo resultados verificados y ejecutá la suite global después.

## Reglas técnicas obligatorias

### Next.js

- Las páginas y layouts son Server Components salvo interacción real.
- Los Server Components leen repositorios/helpers directamente; no hacen HTTP
  interno a la propia aplicación.
- Pasá a componentes cliente sólo props serializables y mínimas.
- `params`, `searchParams`, `headers()` y APIs equivalentes se tratan como async.
- Usá `next/link` para navegación interna.
- Para imágenes públicas optimizables preferí `next/image`. Para blobs locales
  o endpoints privados que no puede consumir el optimizador, documentá una
  excepción localizada y liberá los object URLs.
- Evitá waterfalls; iniciá lecturas independientes juntas con `Promise.all`.

### API y seguridad

- Cuerpo JSON máximo: 64 KiB, Content-Type estricto y errores estables.
- Binarios con lectura streaming y límite temprano.
- Nunca confíes en IDs, slugs, precios, códigos, hashes o cálculos del cliente.
- Toda mutación revalida estado y tiempo del servidor.
- Las altas usan idempotency keys estables y fingerprint canónico.
- Mismo key + mismo comando reproduce; mismo key + comando distinto devuelve
  409 sin escrituras parciales.
- Los uploads privados usan capability tokens fuertes; un código público nunca
  autoriza por sí solo.
- Autorizá antes de leer PII, metadata privada o bytes.
- No registres PII, tokens, cuerpos, fotos, command hashes ni claves de
  idempotencia en logs.
- Aplicá límites de abuso en la plataforma, no contadores en memoria del Worker.

### D1 y R2

- D1 es la fuente de verdad de metadata y estados; R2 almacena bytes.
- D1 y R2 no son una transacción: modelá estados explícitos, reintentos y
  compensación.
- Sólo media `READY` se lista o entrega.
- Nunca hagas borrado físico de datos comerciales desde el panel.
- Cada cambio sensible requiere actor, auditoría, control de versión y estado
  anterior válido.
- Las migraciones deben funcionar desde cero, desde la versión anterior y al
  reejecutarse sin cambios.
- Drizzle schema, SQL, snapshots y journal deben describir lo mismo.

### Datos comerciales

- Ningún plan financiero DEMO puede presentarse como real.
- Ninguna unidad vieja/reservada/vendida puede aparecer como disponible hoy.
- Oferta y financiación se evalúan con reloj del servidor y fin exclusivo.
- Cliente y vendedor ven el mismo snapshot persistido.
- Si precio, stock, promoción o tarifario cambian antes de confirmar, devolver
  un conflicto y obligar a recalcular.
- No prometer aprobación crediticia, tasación final, publicación automática ni
  entrega efectiva a WhatsApp/CRM si sólo existe click-to-chat.

## Validación de cada vertical

Antes de cerrar una vertical, ejecutá pruebas proporcionales al riesgo:

- unitarias de dominio/contrato;
- API con errores, replay y conflictos;
- SQL real con constraints y foreign keys;
- fallas inyectadas entre D1 y R2;
- autorización fail-closed;
- UI con éxito, error, carga y reintento;
- Wrangler con D1/R2 reales cuando haya persistencia o uploads.

Después ejecutá la validación global:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run db:generate
npm run db:drill
git diff --check
git status --short
```

Si `db:generate` crea un archivo inesperado, no lo aceptes automáticamente:
investigá drift entre schema, SQL y snapshots.

## Puertas antes de publicar

No publiques una versión nueva hasta demostrar:

- worktree limpio;
- migraciones completas y repetibles;
- backup y restore drill del esquema completo;
- pruebas globales verdes sin errores ocultos;
- recorrido comercial real en Wrangler;
- fotos privadas inaccesibles públicamente;
- entorno Sites con valores confirmados;
- ausencia de errores nuevos en logs;
- commit publicado exactamente igual a `HEAD`;
- documentación y UI coherentes con el alcance real.

Publicá primero de forma privada. No hagas pública la app ni cambies accesos sin
autorización expresa del usuario.

## Definición de terminado

El trabajo no termina al compilar. Termina cuando el criterio correspondiente
de `GOAL_JDA_CANDIDATA_PRODUCCION.md` tiene evidencia directa, el código y la
documentación coinciden, no quedan cambios sin integrar y la versión privada
publicada corresponde al commit validado.

Ante un bloqueo comercial, no inventes. Entregá el software hasta la frontera
segura, documentá exactamente qué debe confirmar JDA y continuá con todo lo que
no dependa de esa respuesta.
