# Puertas de salida antes de producción

Estado de las trece condiciones que el plan maestro exige para publicar la V1.
Cada una dice qué resuelve el código y qué falta de parte del negocio. Lo que
depende de una decisión de JDA no se marca como cumplido aunque el código ya
lo soporte: el software puede estar listo y la condición comercial no.

## Revalidación de la migración — 4 de septiembre de 2026

El checkout inicial `7c18cb7` pasa build y 419 pruebas. Eso no certifica todavía
la migración a Vercel: la revisión encontró autorización por email no verificado,
tooling dependiente de `dist` antiguo, respuestas D1 incompletas aceptadas,
identidad de rate limit de Cloudflare y fotos mayores al límite de Vercel.
El corte de corrección y sus pruebas se registran en `MIGRACION_VERCEL.md`.

Faltan las credenciales remotas y la habilitación de cuentas internas. No hay
evidencia nueva de Preview/Production. Las verificaciones con Worker que siguen
son **históricas** y no sustituyen el recorrido Next → D1/R2 remotos.

Verificación histórica: 1 de septiembre de 2026, con 257 pruebas, lint, TypeScript
y build en verde, la D1 local migrada hasta 0011, el ensayo de restauración
sobre las veintiocho tablas del esquema, el limitador de abuso por IP cubriendo
todas las mutaciones públicas y la consignación aislada como V1.1 endurecida.

El recorrido de la cuenta se verificó además contra el Worker real con Wrangler
y la D1 local: el alta devuelve 201 y entrega la sesión en cookie `HttpOnly`
`SameSite=Lax`; `/cuenta` sin sesión redirige a `/cuenta/ingresar` y las cuatro
rutas privadas de la API responden 401; el ingreso con contraseña incorrecta y
con un correo inexistente devuelve exactamente la misma respuesta, byte por
byte, así que no se puede averiguar qué correos están registrados.

## Resueltas por código

**7. Analítica del embudo funcionando.**
El panel muestra el recorrido de los últimos 30 días —operaciones simuladas,
con contacto dejado, handoffs de WhatsApp, contactados y cerrados— con la
conversión de cada paso, calculado con consultas sobre las tablas reales. Una
ventana sin operaciones se declara vacía en lugar de mostrar ceros con tasas.
Lo que necesita telemetría de cliente o registro de venta (impresiones, vistas,
aperturas reales de WhatsApp, venta atribuida, diferencia entre cuota simulada
y cotizada) figura como no medido en la misma pantalla y no se estima.

**8. Simulación reproducible por cliente y vendedor.**
`/simulaciones/{codigo}` y el panel leen el mismo snapshot congelado.
`tests/e2e-commercial-journey.test.mjs` recorre el viaje completo sobre una
base real y compara importe por importe las dos vistas; también cubre la
unidad retirada y la operación vencida, donde cambian los estados y nunca los
importes.

**9. Oferta no aplicable fuera de vigencia.**
La vigencia se evalúa con la hora del servidor y con final exclusivo, y la
confirmación de una operación rechaza la promoción que cambió
(`tests/domain-promotions.test.mjs`, `tests/api-simulation-integrity.test.mjs`).

**10. Flujo mobile completo desde 320 px.**
Verificado en el navegador a 320 px sobre las nueve superficies públicas —
portada, stock, ficha, buscador, tasación, oferta, contacto y las dos pantallas
de cuenta—: ninguna provoca desplazamiento horizontal y ningún control queda por
debajo de 44 px, contando el `label` cuando es el que recibe el toque. Cada
página abre con "Saltar al contenido" y expone foco visible.

La medición del 1 de septiembre de 2026 desmintió la versión anterior de esta
línea, que daba los 44 px por cumplidos en todas partes. Cinco controles no
llegaban: el `select` de orden del stock medía 16 px sin label que lo
envolviera, el enlace de marca 39, "Volver al stock" 20, "Ver todos" 30 —en
móvil su texto se oculta y sólo queda la flecha— y el enlace entre alta e
ingreso de cuenta 15. Los cinco quedaron corregidos por CSS, sin tocar
marcado ni reglas de negocio; los checkboxes de plazos y usado ya cumplían a
través de su `label` de 44 y 53 px.

**11. Backups y restauración ensayados.**
`npm run db:drill` exporta la base, la restaura en una base descartable y
compara los conteos de las tablas del esquema —la lista sale del snapshot vigente
de Drizzle, no de una enumeración escrita a mano, así que una migración nueva no
puede dejar una tabla afuera— y falla si falta un conteo o alguno no coincide.
El volcado se reordena para que sea restaurable. Ensayado contra la D1 local;
el control de conteos no certifica igualdad de contenido ni backup de bytes R2.

**12. Fotos privadas inaccesibles públicamente.**
Las fotos de tasación viven en R2 privado, se sirven sólo por el binario
protegido del panel y se les limpian los metadatos antes de guardarlas
(`tests/media-exif.test.mjs`, `tests/appraisal-media-api.test.mjs`).

Verificado además contra el Worker real el 1 de septiembre de 2026: el alta de
tasación devuelve 201 con su código, la foto sube 201 y el reintento con la
misma clave devuelve 200 con el mismo media, y la respuesta pública no expone
URL, clave ni ruta de R2. Una imagen de 306 bytes con un chunk `tEXt` se
persistió en 252: los metadatos se limpian en el servidor, no en el cliente.
Sin sesión del panel, las cuatro rutas administrativas —incluida la que entrega
los bytes— responden 401, y un identificador de media inventado responde el
mismo 401 que uno real, así que la autorización ocurre antes de la búsqueda y no
revela qué existe. El código público por sí solo no entrega nada.

**13. Procedimiento operativo para corregir stock, tasas y ofertas.**
El panel administra stock, tarifarios y promociones con autorización,
idempotencia, control de versión y auditoría, sin borrados físicos. Las
migraciones y el backup tienen comandos repetibles documentados en el README.

## Listas en código, pendientes de dato real

**1. Fuente de stock y umbral de frescura.**
El umbral vive en el perfil del negocio (`stock_freshness_minutes`, hoy 1440) y
la web degrada a "consultar disponibilidad" cuando el dato envejece.

Ya existe el adaptador de sincronización externa: `npm run stock:sync` cruza la
planilla publicada de JD-Auto (precio y moneda), Supabase (identidad de la
unidad y sus fotos) y el disco local (originales), y deja su corrida auditada
en `stock_sync_run` y el mapeo en `external_stock_mapping`. Corrida el 3 de
septiembre de 2026 contra las tres fuentes reales: 57 unidades en la planilla,
39 activas en JD-Auto, 10 publicables con 12 fotos cada una; las 47 restantes
quedaron rechazadas con su motivo (sin ficha en JD-Auto, sin año informado).
Verificado en el navegador contra el Worker real: la ficha muestra las fotos
del salón de JDA, no un marcador de posición.

Falta que JDA confirme el umbral de frescura y decida si esta sincronización
corre a demanda o con una cadencia programada; hoy es un comando manual, no un
proceso continuo.

**2. Planes financieros reales cargados y vigentes.**
El motor lee tarifarios versionados de D1 y rechaza operar sin uno vigente. El
único cargado es el tarifario DEMO, marcado como ficticio en cada pantalla.

**4. Mensajes legales y consentimientos revisados.**
El consentimiento se pide, se registra con evidencia y se congela en el
snapshot. Los textos siguen siendo los redactados durante el desarrollo y
necesitan revisión de JDA antes de publicar.

**5. Número y enlace de WhatsApp confirmados.**
Ninguna superficie pública escribe un número: header, footer, navegación,
formularios y fichas leen el perfil y, sin WhatsApp configurado, enlazan a
`/contacto`. El número +5492494587046 cargado por la migración 0003 quedó
retirado (migración 0009) por falta de evidencia de confirmación: la pregunta
exacta vive en [DECISIONES_JDA.md](DECISIONES_JDA.md) (#5). Cuando JDA
confirme el E.164 y la modalidad, se carga en el perfil del negocio.

**6. Accesos internos del panel probados.**
El panel exige sesión propia, `PANEL_ALLOWED_EMAILS` y
`PANEL_ALLOWED_ACCOUNT_IDS`, y falla cerrado ante configuración vacía o inválida.
Falta confirmar la titularidad de las cuentas internas, cargar sus IDs y
correos en cada entorno y probarlas contra el runtime remoto. Registrar un
correo de la allowlist no habilita una cuenta pública como administrador.

## Abiertas

**3. Casos dorados aprobados por JDA.**
No hay un set de operaciones de referencia revisado por el negocio. Sin eso,
las pruebas verifican coherencia interna, no criterio comercial.

## Endurecimiento transversal

**Límites de abuso.** Todas las mutaciones públicas —búsqueda, simulación,
lead, handoff, tasación con sus fotos y consignación con sus fotos— pasan por
un limitador por IP con ventana fija persistido en D1 (`rate_limit_window`),
sin contadores en memoria del Worker. Responde 429 estable con `Retry-After`,
el tope y la ventana se ajustan por entorno sin desplegar código
(`tests/rate-limit.test.mjs`) y la tabla entra en el backup y el ensayo de
restauración. Comprobado en el Worker real: superado el tope de altas
de tasación, la siguiente responde 429 con `Retry-After: 121` y el cuerpo
estable `RATE_LIMITED`.

**Permisos.** La V1 usa una única allowlist de administradores
(`PANEL_ALLOWED_EMAILS`): todos los correos habilitados operan todo el panel,
cada acción sensible queda auditada por actor y el acceso falla cerrado sin
configuración. Los roles por función quedan para una versión posterior
([DECISIONES_JDA.md](DECISIONES_JDA.md) #8).

## Cuenta del cliente

Implementada como capacidad **opcional**: ninguna superficie del flujo
principal la exige y las pruebas lo verifican sobre el código de las páginas
públicas. Cubre los ítems 201 a 212 de la sección R del relevamiento —alta,
ingreso, perfil, datos personales, vehículo actual, presupuesto, cuota máxima,
marcas y tipo preferidos, favoritos, búsquedas guardadas, tasaciones y
simulaciones—; conversaciones con IA (214) y test drives (213) quedan fuera
porque no existe el circuito que los produce.

Resuelto por código: contraseña derivada con PBKDF2-HMAC-SHA256 y sal por
cuenta con iteraciones versionadas y rehash al ingresar; sesión de 256 bits en
cookie HttpOnly/SameSite=Lax/Secure de la que sólo se persiste el SHA-256;
respuesta indistinguible ante correo inexistente y contraseña incorrecta;
bloqueo por intentos y límite por IP; revocación de las demás sesiones al
cambiar la contraseña; rutas privadas que fallan cerradas.

Pendiente del negocio:

- **No hay recuperación de contraseña ni verificación de correo.** Ambas
  necesitan un proveedor de envío que JDA no definió
  ([DECISIONES_JDA.md](DECISIONES_JDA.md) #10). Hoy, quien olvida la contraseña
  depende de que el equipo lo asista a mano.
- El texto de consentimiento del alta sigue sin revisión legal, igual que el
  resto de los textos (#7).

## Consignación virtual (V1.1)

Implementada y endurecida por código (plan en
[PLAN_CONSIGNACION_VIRTUAL.md](PLAN_CONSIGNACION_VIRTUAL.md)), pero **aislada
como capacidad opcional V1.1**: no aparece en la navegación, la portada ni el
sitemap de la candidata V1, y su ruta directa declara `noindex` con un aviso
de capacidad en revisión. El circuito completo:

- Alta atómica: lead + consentimiento + consignación en un único batch D1,
  idempotente por clave con hash de comando (replay reproduce, otro comando
  es 409 sin escrituras).
- Autorización de carga por token bearer de 256 bits entregado una sola vez
  en el alta; de D1 sólo se guarda su SHA-256. Código inexistente, token
  incorrecto o faltante y registro legacy responden 404 indistinguible.
- Lifecycle de media `PENDING → READY | FAILED → ARCHIVED` con confirmación
  por versión, reanudación de fallos de R2 con la misma clave y archivo,
  archivo de reservas abandonadas con limpieza de objetos huérfanos. Sólo
  `READY` se lista o entrega.
- El servidor exige exactamente cinco fotos `READY` antes de
  `SUBMITTED → IN_REVIEW`.
- Migración 0008 con snapshot Drizzle coherente (`npm run db:generate`
  responde sin cambios; la cadena aplica desde cero e incrementalmente y el
  ensayo de restauración incluye las tablas nuevas).

Lo que sigue pendiente del negocio para habilitarla:

- Comisión, contrato de consignación y mecanismo de retiro de la unidad: sin
  eso, `ACCEPTED` sólo habilita la oferta y la publicación en stock sigue
  siendo manual.
- Definir si el precio esperado por el dueño se muestra al equipo tal cual se
  recibe (hoy es orientativo y nunca se publica).

## Base de demostracion reproducible

La prueba comercial de punta a punta necesita una base DEMO fresca y hasta hoy
no habia comando para dejarla asi. `npm run db:seed` vuelve a sellar el stock,
deja un tarifario vigente y una oferta con vencimiento a 23 horas, todo marcado
como ficticio; `--dry-run` imprime el SQL y la base alojada exige
`--remote --confirm-demo`.

Importa porque el motor degrada a "consultar disponibilidad" cualquier unidad
cuyo dato supere el umbral de frescura del perfil (1440 minutos). Sobre una base
sembrada dias atras, las cuatro unidades responden `vehicle_snapshot_not_current`
y el recorrido no se puede mostrar: la respuesta es correcta y la demostracion es
imposible. Sembrada de nuevo, el motor vuelve a rechazar por razones economicas
reales —`monthly_payment_exceeded`, `finance_ratio_exceeded`, `above_maximum_finance_amount`—
y las unidades alcanzables aparecen.

Recorrido verificado el 1 de septiembre de 2026 contra el Worker real con esa
base: busqueda con resultados alcanzables; alta de simulacion 201, replay con la
misma clave y el mismo comando 200 con identico codigo, y misma clave con otro
comando 409 `OPERATION_CHANGED` sin escribir; pagina publica del snapshot y API
con los mismos importes —cuota, precio y saldo— y el aviso DEMO; lead con
contexto 201 y replay idempotente; handoff 409 `WHATSAPP_NOT_CONFIGURED` porque el
perfil sigue sin numero confirmado, con `whatsappE164: null` en la API.

## Nota histórica de entorno

El error de `vinext start` en Windows pertenecía al runtime anterior. Ahora
`npm start` ejecuta Next.js y requiere la persistencia remota para operar.
Wrangler se conserva para mantenimiento y ensayos de D1/R2, sin publicar
Workers ni Sites. Con el preview del Worker anterior se ejecutó el recorrido comercial
completo contra el Worker real: búsqueda con resultados alcanzables, simulación
con alta, replay idéntico y conflicto 409, snapshot público por API y página,
lead con contexto y replay, handoff que responde `WHATSAPP_NOT_CONFIGURED`
sin número confirmado, panel y media fallando cerrado sin sesión, y el limitador
respondiendo 429 con `Retry-After` y contadores persistidos en D1 que sobreviven
reinicios del Worker.

## Migración de persistencia a Supabase — 4 de septiembre de 2026

Por instrucción del usuario, la base de datos se migró de Cloudflare D1
(SQLite) a Postgres en Supabase; el object storage sigue en Cloudflare R2
(compatible S3) hasta que se complete su propia migración a Supabase Storage,
todavía pendiente por falta de credenciales.

Alcance de esta migración:

- esquema completo (36 tablas) reescrito de `drizzle-orm/sqlite-core` a
  `drizzle-orm/pg-core`, con dos correcciones de fondo encontradas en el
  camino: 23 columnas de importes en centavos que en SQLite tenían afinidad
  flexible pasaron a `bigint` (`integer` de Postgres se queda corto, sólo 32
  bits, con montos en pesos con inflación) y el driver `postgres.js` se
  configuró para devolver esos `bigint` como `number`, no como texto;
- `db/supabase-remote.ts` reemplaza a `db/d1-remote.ts`: mismo contrato
  `D1Database` (`prepare/bind/first/all/run/batch/exec`) que ya consumían los
  doce repositorios de `lib/data/*.ts`, así que ese código de negocio no se
  reescribió; sólo se tradujeron los `?` a `$1, $2, ...` y `changes()` de
  SQLite (sin equivalente en Postgres) por el conteo real de la sentencia
  anterior dentro de la misma transacción;
- `INSERT OR IGNORE`, `json_extract()` y `rowid` (los tres sin equivalente
  directo en Postgres) se corrigieron caso por caso en `lib/data/*.ts` y
  `lib/server/funnel-data.ts`;
- las diecisiete migraciones SQLite se archivaron en `drizzle-sqlite-archive/`
  (no se borró evidencia) y se generó una migración inicial de Postgres
  consolidada, aplicada contra la Supabase real;
- suite completa verde (423 pruebas, 8 omitidas por diseño sin
  `SUPABASE_DB_URL`), lint y `tsc --noEmit` limpios, `db:generate` sin
  diferencias contra el esquema vigente;
- `scripts/seed-demo-d1.mjs`, `scripts/d1-migrate.mjs` y
  `scripts/d1-backup.mjs` reescritos contra Postgres nativo (sin Wrangler): el
  ensayo de restauración crea y descarta su propio esquema de Postgres
  (nunca toca `public`) y comparó los conteos de las 36 tablas correctamente
  contra la Supabase real; `scripts/stock-sync.mjs` también se adaptó a la
  base nueva, aunque no se pudo ensayar de punta a punta por depender del
  entorno del proyecto hermano JD-Auto.

**Actualización — 5 de septiembre de 2026:** se re-corrió
`npm run stock:sync -- --confirm-remote` contra la Supabase nueva; las 10
unidades reales y sus 120 fotos ya están publicadas ahí (antes sólo estaban en
la D1 vieja). Ver la sección "Migración de object storage a Supabase Storage"
más abajo por el corte de bytes: esa misma corrida fue la primera escritura
real en Supabase Storage. Sigue sin ser inventario oficial hasta que JDA
confirme (ver fila 1 de `DECISIONES_JDA.md`).

## Migración de object storage a Supabase Storage — 5 de septiembre de 2026

Por instrucción del usuario, el object storage se migró de Cloudflare R2 a
Supabase Storage, vía su protocolo S3 compatible, en el mismo proyecto que ya
aloja `SUPABASE_DB_URL`.

Alcance de esta migración:

- `lib/data/supabase-storage-remote.ts` reemplaza a `lib/data/r2-remote.ts`:
  mismo contrato `ObjectStore` (`putStockImage/putPrivateAppraisalImage/
  putPrivateConsignmentImage/getStockObject/getPrivateObject/deleteObject`)
  que ya consumían los servicios de `lib/server/*-media.ts`, así que ese
  código de negocio no se reescribió; sólo cambió la construcción del cliente
  S3 (`region` explícita en vez de `"auto"`, `forcePathStyle: true` porque el
  endpoint de Supabase Storage vive bajo `/storage/v1/s3` en vez de la raíz
  del host) y las cinco variables de entorno (`SUPABASE_STORAGE_ENDPOINT`,
  `SUPABASE_STORAGE_REGION`, `SUPABASE_STORAGE_BUCKET`,
  `SUPABASE_STORAGE_ACCESS_KEY_ID`, `SUPABASE_STORAGE_SECRET_ACCESS_KEY`);
- `lib/data/storage.ts` renombra su clase concreta de `R2ObjectStore` a
  `SupabaseObjectStore`; `scripts/stock-sync.mjs` se adaptó al mismo cliente
  y variables nuevas;
- bucket creado por el usuario en el dashboard de Supabase: `jda-media`
  (privado);
- `scripts/validate-vercel-env.mjs` exige las cinco variables de Supabase
  Storage en vez de las cuatro de Cloudflare R2.

Sin efecto en este cambio: no se migraron bytes existentes, porque el bucket
de R2 no tenía fotos reales publicadas todavía (el catálogo vigente era DEMO).
Esas fotos reales se escribieron directamente en Supabase Storage el mismo 5
de septiembre, al re-correr `npm run stock:sync -- --confirm-remote` (ver
"Actualización — 5 de septiembre de 2026" en la sección de arriba y fila 1 de
`DECISIONES_JDA.md`).

**Bug encontrado y corregido el mismo 5 de septiembre de 2026:**
`resolveRuntime()` en `scripts/stock-sync.mjs` no propagaba `dryRun`,
`skipPhotos` ni `photoLimit` desde `parseArgs()` — sólo copiaba lo que
devuelve `resolveDataRuntime()` (`remote/connectionString/sql/d1/cleanup`).
Como consecuencia, `--dry-run` no tenía ningún efecto desde que
`resolveRuntime()` se reescribió contra Postgres nativo (commit `ceceeea`):
cualquier corrida, con o sin `--confirm-remote`, escribía en la Supabase real.
Se descubrió al intentar previsualizar este mismo re-sync: la corrida "de
prueba" terminó siendo la escritura real de las 10 unidades y sus 120 fotos.
Corregido copiando esas tres banderas explícitamente desde `options`; agregado
un test de regresión en `tests/stock-sync.test.mjs` que verifica la
propagación contra un fixture de JD-Auto en un directorio temporal, sin tocar
Supabase.

## Bug crítico de aliases SQL sin comillas — 5 de septiembre de 2026

Al cerrar la vertical de consignación virtual se agregó
`tests/e2e-consignment-journey.test.mjs`: el primer intento de subir una foto
contra la Supabase real devolvió `404 CONSIGNMENT_NOT_FOUND` — un caso que
todas las pruebas contra fixtures/`node:sqlite` daban por bueno.

Causa raíz: Postgres pliega a minúsculas cualquier identificador sin comillas,
alias de columna incluidos. Todo `SELECT columna_snake AS aliasCamelCase` sin
comillas devuelve la fila con la clave `aliascamelcase` (todo en minúsculas),
no `aliasCamelCase`; el código JS que lee `row.aliasCamelCase` obtenía
`undefined` — nunca un error, así que fallaba en silencio. SQLite, en cambio,
conserva el alias tal cual se escribió, por lo que ninguna prueba contra
fixtures lo detectaba. Comprobado de forma empírica contra la Supabase real:
`SELECT 1 AS someCamelCase` devuelve la fila con clave `somecamelcase`.

Alcance verificado con `grep -rE "AS [a-z][a-zA-Z0-9_]*[A-Z]"` sobre
`lib/`, `scripts/` y `db/`: **seis archivos**, todos con el mismo patrón,
corregidos poniendo cada alias entre comillas dobles (`AS "aliasCamelCase"`,
que Postgres y SQLite conservan tal cual):

- `lib/data/consignment-media-repository.ts` — `findConsignmentByPublicCode()`
  comparaba `consignment.uploadTokenHash` (siempre `undefined`, convertido a
  la cadena literal `"undefined"`) contra el hash real del bearer: **ninguna
  carga de foto de consignación contra la Supabase real podía autorizarse**,
  siempre con 404 aunque el token fuera correcto.
- `lib/data/vehicle-media-repository.ts` — `findPublic()` es la que sirve las
  fotos públicas de stock; con el bug, cada registro traía `r2Key: "undefined"`
  y el resto de los campos igual de rotos. Los bytes de las 120 fotos reales
  publicadas el mismo día (ver arriba) están bien en Supabase Storage, pero
  **la ruta pública que las sirve no podía resolver su clave real** hasta este
  fix — sin este corte, el catálogo recién publicado habría mostrado fotos
  rotas en cuanto alguien lo probara contra la Supabase real.
- `lib/data/lead-conversion-repository.ts` — `findLinkedContext()` (replay de
  idempotencia y handoff de WhatsApp) y el resto de sus consultas con alias;
  no lo detectó la prueba e2e existente porque el camino feliz no pasa por
  `findLinkedContext()`.
- `lib/data/appraisal-media-repository.ts`, `lib/data/consignment-intake-repository.ts`,
  `lib/data/admin-repositories.ts` (incluye `currentConflict()`, compartida por
  **todas** las mutaciones del panel: un conflicto de versión venía devolviendo
  el `currentVersion` que mandó el cliente, no el real, en cualquier recurso).

Validación: `npm test` (424 pruebas verdes, 9 omitidas sin `SUPABASE_DB_URL`/
`SUPABASE_STORAGE_*`), lint y `tsc --noEmit` limpios, y las tres corridas
reales (`tests/supabase-remote.test.mjs`, `tests/e2e-commercial-journey.test.mjs`,
`tests/e2e-consignment-journey.test.mjs`) verdes contra la Supabase y el
Supabase Storage reales — la de consignación fallaba con 404 antes del fix y
pasa después, sin cambiar nada más que las comillas.

## Consignación virtual verificada contra infraestructura real — 5 de septiembre de 2026

`tests/e2e-consignment-journey.test.mjs` cierra el hueco que señalaba el
criterio 9 de `GOAL_JDA_CANDIDATA_PRODUCCION.md` ("el recorrido completo fue
probado en UI, API, Supabase y R2 [hoy Supabase Storage] con evidencia"): las
pruebas de `tests/consignment-*.test.mjs` cubren el mismo recorrido contra
fixtures/`node:sqlite`, no contra Postgres real ni el bucket real. La prueba
nueva corre dentro de una transacción de Postgres que siempre revierte (mismo
patrón que `tests/e2e-commercial-journey.test.mjs`) y borra a mano, en un
`finally`, cada objeto que escribe en Supabase Storage (no participa de la
transacción). Cubre de punta a punta: alta con token de 256 bits entregado una
sola vez, cinco fotos reales (FRONT/REAR/SIDE/INTERIOR/DASHBOARD) subidas,
limpiadas de metadatos y confirmadas `READY` contra el bucket real, el
servidor rechazando pasar a `IN_REVIEW` sin las cinco, la revisión real
(`SUBMITTED → IN_REVIEW → ACCEPTED`) y el cierre rechazando cargas tardías.

De los ocho puntos de la Fase 1 de `GOAL_JDA_CANDIDATA_PRODUCCION.md`, los
siete primeros (token de carga, alta atómica, claves de cliente estables,
ciclo recuperable, exigencia server-side de cinco fotos, migración consolidada
a Postgres, privacidad/EXIF/límites) ya estaban implementados y probados
contra fixtures desde antes de esta sesión (ver `AGENTS.md`); esta prueba es
la primera evidencia de que también funcionan contra la infraestructura real.
El punto 8 (dividir `ConsignmentForm.tsx`) ya estaba resuelto: 210 líneas,
sin archivo de una sola línea.
