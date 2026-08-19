# Puertas de salida antes de producción

Estado de las trece condiciones que el plan maestro exige para publicar la V1.
Cada una dice qué resuelve el código y qué falta de parte del negocio. Lo que
depende de una decisión de JDA no se marca como cumplido aunque el código ya
lo soporte: el software puede estar listo y la condición comercial no.

Última verificación: 19 de agosto de 2026, con 182 pruebas, lint y build en
verde y la D1 local migrada.

## Resueltas por código

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
compara diez tablas; falla si alguna no coincide. El volcado se reordena para
que sea restaurable. Ensayado contra la D1 local.

**12. Fotos privadas inaccesibles públicamente.**
Las fotos de tasación viven en R2 privado, se sirven sólo por el binario
protegido del panel y se les limpian los metadatos antes de guardarlas
(`tests/media-exif.test.mjs`, `tests/appraisal-media-api.test.mjs`).

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
Ninguna superficie pública escribe un número: header, footer, navegación y
fichas leen el perfil y, sin WhatsApp configurado, enlazan a `/contacto`.
Falta cargar el número confirmado en el perfil del negocio.

**6. Roles y accesos internos probados.**
El panel exige la allowlist `PANEL_ALLOWED_EMAILS` y falla cerrado ante
configuración vacía o inválida (`tests/panel-auth.test.mjs`). Falta cargar las
cuentas reales del equipo y probar el acceso con ellas.

## Abiertas

**3. Casos dorados aprobados por JDA.**
No hay un set de operaciones de referencia revisado por el negocio. Sin eso,
las pruebas verifican coherencia interna, no criterio comercial.

**7. Analítica del embudo funcionando.**
`lead_event` registra los hitos del recorrido y el panel muestra contadores
operativos (leads, stock, tasaciones, ofertas), pero todavía no hay un embudo
que relacione búsquedas, simulaciones, handoffs y cierres.

## Nota de entorno

`npm start` (`vinext start`) falla en Windows con `ERR_UNSUPPORTED_ESM_URL_SCHEME`.
No afecta a `npm run dev`, al build ni al despliegue; sí impide levantar el
build de producción localmente en esa plataforma.
