# Puertas de salida antes de producción

Estado de las trece condiciones que el plan maestro exige para publicar la V1.
Cada una dice qué resuelve el código y qué falta de parte del negocio. Lo que
depende de una decisión de JDA no se marca como cumplido aunque el código ya
lo soporte: el software puede estar listo y la condición comercial no.

Última verificación: 1 de septiembre de 2026, con 257 pruebas, lint, TypeScript
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
Verificado en el navegador a 320 px: ninguna de las superficies públicas
provoca desplazamiento horizontal y los blancos táctiles llegan a 44 px.
Cada página abre con "Saltar al contenido" y expone foco visible.

**11. Backups y restauración ensayados.**
`npm run db:drill` exporta la base, la restaura en una base descartable y
compara las veintiocho tablas del esquema —la lista sale del snapshot vigente
de Drizzle, no de una enumeración escrita a mano, así que una migración nueva no
puede dejar una tabla afuera— y falla si alguna no coincide. El volcado se reordena para que sea
restaurable. Ensayado contra la D1 local.

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
la web degrada a "consultar disponibilidad" cuando el dato envejece. Falta que
JDA confirme el umbral y de dónde sale el stock: hoy se carga por el panel y no
hay adaptador de sincronización externa (las tablas `external_stock_mapping` y
`stock_sync_run` existen, sin proceso que las use).

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
El panel exige la allowlist `PANEL_ALLOWED_EMAILS` y falla cerrado ante
configuración vacía o inválida (`tests/panel-auth.test.mjs`). Falta cargar las
cuentas reales del equipo y probar el acceso con ellas.

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

## Nota de entorno

`npm start` (`vinext start`) falla en Windows con `ERR_UNSUPPORTED_ESM_URL_SCHEME`.
El preview del build de producción se hace con Wrangler y la D1 local
(`npx wrangler dev --config dist/server/wrangler.json --persist-to .wrangler/state`,
documentado en el README); con ese preview se ejecutó el recorrido comercial
completo contra el Worker real: búsqueda con resultados alcanzables, simulación
con alta, replay idéntico y conflicto 409, snapshot público por API y página,
lead con contexto y replay, handoff que responde `WHATSAPP_NOT_CONFIGURED`
sin número confirmado, panel y media fallando cerrado sin sesión, y el limitador
respondiendo 429 con `Retry-After` y contadores persistidos en D1 que sobreviven
reinicios del Worker.
