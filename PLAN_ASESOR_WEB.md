# Asesor de JDA dentro de la app

Pedido confirmado el 6 de septiembre de 2026: conversación natural dentro
de la app primero; WhatsApp después. Esta instrucción posterior habilita este
corte adicional al alcance V1. No habilita envíos a clientes ni publicación
pública de la aplicación.

## Objetivo completo y orden confirmado

La ampliación posterior pide planificación con Astra e implementación con
Luna: agente dentro de la app, referencia de valor de MercadoLibre, búsqueda
del cliente persistida en CRM y continuidad por WhatsApp mediante Zernio.
El corte de lectura descrito abajo es un primer paso, no satisface por sí solo
el objetivo completo. Astra revisó el código y congeló el siguiente recorrido.

1. Conversación natural: responder primero, preguntar un dato por vez y
   conservar un resumen editable de lo declarado por el cliente.
2. Mostrar evidencia comercial en tarjetas generadas por el servidor:
   stock vigente, moneda, estado DEMO, fuentes y fecha. El texto del modelo
   no constituye una oferta ni autoriza operaciones.
3. Preparar la búsqueda y mostrarla para revisión. Sólo una acción explícita
   del cliente confirma su contenido y consentimiento para registrarla.
4. Relacionar usado, efectivo y cuota con el motor determinista existente.
   La selección confirmada produce el mismo snapshot para cliente y vendedor.
5. Continuar por WhatsApp con contexto autorizado y estados verificables.

## Contratos de las siguientes verticales

### Conversación y registro en CRM

- Sesión anónima con capability aleatoria de 256 bits en cookie HttpOnly,
  Secure y SameSite; persistir sólo hash SHA-256, expiración y revocación.
- El cliente envía mensaje nuevo, identificador de turno y versión esperada.
  El historial del navegador nunca prueba identidad, selección ni aprobación.
- Presupuesto total, efectivo y cuota son campos distintos. Datos no
  declarados quedan ausentes; la IA propone, el cliente revisa.
- Nombre/contacto se solicitan al guardar, con consentimiento de alcance
  explícito. Consultar sobre una búsqueda no autoriza campañas.
- Una transacción crea lead, consentimiento versionado, pasaporte, demanda
  y evento CRM. Clave estable y fingerprint canónico: mismo comando reproduce;
  distinto comando con la misma clave devuelve 409 sin escritura parcial.
- No vincular ni revelar un lead existente por un teléfono no verificado.
- Confirmar únicamente lo persistido; guardar una búsqueda no significa
  que un mensaje de WhatsApp fue enviado o entregado.

### Referencia de MercadoLibre

- Requiere acceso autorizado y comprobado a la fuente. Un adaptador simulado
  no certifica la integración; una carga verificada del equipo puede ser una
  entrada alternativa identificada, pero no reemplaza silenciosamente el pedido.
- Persistir ID y URL canónica, marca/modelo/versión, año, kilómetros, importe
  entero, moneda original, fecha observada, estado y procedencia de cada dato.
- Cohortes compatibles, deduplicación, exclusiones explicadas y política
  versionada para muestra mínima, vigencia, tolerancias y dispersión.
- Abstenerse si faltan comparables suficientes. No mezclar monedas ni
  transformar precios publicados en valor de toma mediante descuentos inventados.
- El resultado conserva rango observado, cantidad de comparables, fuentes,
  fecha y algoritmo. La tasación JDA requiere política comercial confirmada.

### Continuidad por Zernio

- El CRM mantiene el estado comercial; Zernio transporta los mensajes.
- Persistir la intención de envío antes de llamar al proveedor, con estados
  pendiente/enviado/fallido/desconocido y reconciliación durable.
- No reintentar ciegamente un timeout o 5xx: la plataforma pudo aceptar el
  mensaje. Los eventos de entrega se deduplican y no equivalen a confirmación
  de una operación comercial.
- Verificar identidad para vincular sesión web y conversación; probar cuenta,
  webhook y ciclo de entrega real con destinatario de prueba autorizado.

## Contrato del primer corte de lectura

- `/asesor`: chat accesible sin registro, presentado como asistente virtual.
- Conversa en español rioplatense, responde primero lo preguntado y pide un
  dato por vez cuando hace falta. No finge ser una persona del equipo.
- Consulta únicamente el stock y el perfil comercial públicos. No lee cuentas,
  conversaciones del CRM, documentos ni fotos privadas.
- Los datos se releen en el servidor. Una unidad con stock vencido conserva
  la indicación de consultar disponibilidad y no entrega precio al modelo.
  Las unidades DEMO conservan su advertencia.
- Financiación, tasación y contacto se continúan en sus recorridos existentes.
  El chat no calcula cuotas, aprueba créditos, tasa usados ni confirma visitas.
- Sólo dos herramientas de lectura. No se exponen las herramientas mutadoras
  del asesor WhatsApp ni se crean leads, simulaciones o mensajes salientes.
- Historial local en memoria del componente, máximo 20 mensajes y 12.000
  caracteres por solicitud. No se guarda en la cuenta ni sobrevive a recargar.
  La interfaz explica que la consulta se procesa con IA y evita pedir PII.
- Historial, mensajes y resultados de herramientas son datos no confiables:
  no otorgan permisos ni cambian las instrucciones del servidor.
- API JSON de 64 KiB; validación de roles, alternancia y longitudes;
  rate limit persistido `public.web-advisor`, por defecto 12 solicitudes por
  diez minutos e IP; respuestas sin caché.
- SDK Anthropic exclusivamente servidor, sin reintentos automáticos, turno
  de 25 segundos, dos rondas de herramientas y 700 tokens por respuesta.
  Ante falta de clave o falla devuelve 503 con mensaje estable; no inventa
  una respuesta ni finge haber derivado a una persona.
- Los enlaces salen de rutas conocidas del servidor y de fichas devueltas
  por la consulta de stock; el navegador renderiza texto sin HTML del modelo.

## Plan de integración

1. Chat web estable: en progreso, implementación parcial sin integrar.
2. Confirmación de búsqueda con consentimiento y transacción CRM.
3. Incorporación autorizada y auditable de comparables MercadoLibre.
4. Rango reproducible y revisión de tasación JDA.
5. Integración usado + efectivo + cuota y snapshot comercial.
6. Continuidad WhatsApp por Zernio con persistencia y reconciliación.

Una sola vertical en progreso. Cada una requiere pruebas de contrato,
errores/replay/conflictos, runtime afectado y validación global antes de commit.
El cierre completo exige proveedores reales y publicación privada con SHA
verificado, conforme a las puertas del repositorio.

## Revisión pendiente de corregir

- Chat: envío fallido seguido de mensaje nuevo produce user/user y 422;
  un fetch abortado puede modificar la conversación recién reiniciada.
- El deadline debe cubrir también herramientas pendientes, no sólo el SDK.
- La prueba nueva falla en su importador con EISDIR; TypeScript pasó, pero
  eso no valida el recorrido. No se ejecutó aún la suite global de este corte.
- Pasaportes existentes: replay puede devolver un token cuyo hash no quedó
  guardado; confirmación distinta no tiene fingerprint de conflicto.
- La herramienta WhatsApp confirma pasaporte y crea demanda por separado;
  no reutilizarla sin atomicidad y unicidad de demanda por pasaporte.
- pendingDemand en memoria del turno no prueba consentimiento posterior.
- El motor de coincidencias debe aplicar los tipos aceptados registrados.

Luna agotó su cupo durante la implementación inicial. En el reintento posterior
pudo retomar la API: corrigió el importador de pruebas y agregó límite de
espera para herramientas. La revisión del principal exige cubrir también el
modelo, limpiar listeners y probar deadlines. Se reanudó la corrección de UI.
Se mantiene Luna como ejecutor; no se sustituyó el modelo solicitado.

## Activación pendiente

### Evidencia adicional de revisión

En esta revisión se ejecutaron 66 pruebas existentes de demand-repository,
demand-matching, advisor-demand-tools, zernio-webhook, inbox-outbound y
appraisal-range: todas pasaron. Utilizan SQLite/adaptadores simulados y no
certifican Postgres remoto ni una cuenta real de Zernio.

Una llamada directa a normalizeDemandCriteria({types: ["pickup"]}) y
matchVehicleToDemand con un vehículo type="sedan" devolvió eligible=true,
scoreBps=0, breakdown=[] y exclusions=[]. Se reproduce así la ausencia de
evaluación del tipo solicitado; no implica que la unidad llegue al panel,
que además aplica umbral de puntuación.

La prueba de replay de registrar_demanda sólo verifica ID, resultado ok y
cantidad de pasaportes. No comprueba que el enlace reemitido autorice contra
el hash persistido. La prueba pública confirma dos veces el mismo payload;
no ensaya un segundo payload distinto. Estos verdes no cierran los riesgos
de capability y conflicto identificados por Astra.

`ANTHROPIC_API_KEY` está ausente en el entorno inspeccionado. Se configura
fuera de Git, en el `.env` ignorado y después en Vercel. El modelo se puede
seleccionar con `WEB_ADVISOR_MODEL`; sin selección se conserva el modelo
existente del asesor. No se activa WhatsApp ni se cambia su modo de atención.

La validación con un cliente de modelo simulado prueba contrato y recorridos,
pero no certifica calidad conversacional de un modelo real. Hace falta probar
conversaciones de JDA con el proveedor configurado antes de exponerlo a clientes.
También siguen vigentes las decisiones comerciales pendientes de JDA.

También faltan MERCADOLIBRE_ACCESS_TOKEN, MERCADOLIBRE_CLIENT_ID,
MERCADOLIBRE_CLIENT_SECRET, ZERNIO_API_KEY y ZERNIO_WEBHOOK_SECRET en el
entorno inspeccionado. La consulta pública de búsqueda de MercadoLibre
devolvió 403; no hay evidencia de acceso operativo al mercado de vehículos.
No se enviaron mensajes externos durante esta revisión.

El contrato publicado de Zernio coincide con las rutas y los identificadores
de respuesta del cliente existente. Su documentación limita la protección de
idempotencia a respuestas exitosas durante 24 horas y exige reconciliar fallas
ambiguas; el cliente HTTP por sí solo no cierra esa garantía.
[Referencia oficial de envío](https://docs.zernio.com/messages/send-inbox-message).

Referencia del SDK consultada para timeout, reintentos y uso en servidor:
[documentación oficial de Anthropic](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript).

## Siguiente vertical: búsqueda confirmada dentro de la app → CRM

Contrato propuesto por Astra el 6 de septiembre de 2026 para revisión del
principal antes de asignar implementación a Luna. Esta sección no declara
implementación ni habilita envíos, exposición pública o cuentas nuevas.

### Resultado y frontera

El cliente revisa y corrige lo que busca, decide dejarlo al equipo, completa
nombre/teléfono y acepta un consentimiento específico. Una sola operación
guarda lead, consentimiento, pasaporte confirmado, demanda abierta y evento.
El panel muestra el mismo pedido. La confirmación no depende de una llamada
al modelo y no inicia WhatsApp.

Se conserva el borrador editable en memoria del navegador. No se persiste el
transcript ni se crea una infraestructura de conversaciones para este corte.
La IA puede proponer criterios; la persona los revisa. Ningún tool del modelo
puede confirmar, adjuntar una identidad existente ni aceptar consentimiento.
Un acceso explícito «Guardar mi búsqueda» permite completar el mismo recorrido
sin proveedor de IA configurado. Esto verifica la vertical CRM, pero no
certifica todavía extracción conversacional por un modelo real.

### Sesión mínima y capability

- `POST /api/v1/web-demands/session`, JSON `{}`, crea una sesión anónima vacía
  y entrega exclusivamente por cookie un token CSPRNG de 32 bytes (base64url).
  La respuesta JSON es `{ data: { status: "ACTIVE", version: 1, expiresAt } }`.
  Si ya hay cookie válida, devuelve la sesión existente sin renovarla.
- Cookie de producción: `__Host-jda-demand-session`; `HttpOnly`, `Secure`,
  `SameSite=Strict`, `Path=/`, sin `Domain`. Desarrollo HTTP usa otro nombre,
  `jda-demand-session-dev`; la relajación no se aplica en Vercel.
- TTL absoluto de 24 horas; configurable con
  `WEB_DEMAND_SESSION_TTL_SECONDS`, entero entre 900 y 86400. El servidor
  persiste `expires_at`; el fin es exclusivo y no se desliza con las lecturas.
- Sólo SHA-256 del token en Postgres. No hay token en JSON, URL, logs,
  `localStorage`, `sessionStorage`, eventos o pasaportes. El navegador confirma
  primero la sesión mediante `GET /api/v1/web-demands/session`; recién después
  habilita la confirmación comercial.
- Si se pierde el primer `Set-Cookie`, reintentar bootstrap puede dejar otra
  sesión vacía que expirará; todavía no puede haber un lead ni una demanda.
  Si se pierde la respuesta de confirmación, la cookie ya estaba establecida
  y el reintento usa exactamente la misma capability y clave. No se genera un
  nuevo token en replay. No hace falta secreto HMAC nuevo ni guardar el token
  en claro para reconstruirlo.
- Un cookie alterado/inexistente, sesión revocada o vencida responde 404
  `WEB_DEMAND_SESSION_NOT_FOUND` de manera indistinguible. Confirmar nunca
  crea una sesión implícitamente. Reiniciar la sesión es una decisión visible;
  no se reintenta automáticamente una alta incierta con otra sesión.
- `GET /api/v1/web-demands/session` devuelve sólo estado, versión, vencimiento
  y recibo comercial si existe; nunca identidad ni transcript. Dos pestañas
  comparten una sesión: el servidor acepta una única confirmación. El cambio
  de versión se explica en UI; no se sobrescribe la primera demanda.
- Mutaciones exigen `Origin` del sitio configurado (o origen de desarrollo
  permitido explícitamente), rechazan `Sec-Fetch-Site: cross-site` y no
  habilitan CORS. Cookies por sí solas no sustituyen esta comprobación.
- Todas las rutas usan JSON estricto de 64 KiB y `Cache-Control: no-store`.
  Límites persistidos por IP y sesión: bootstrap 6/10 min/IP; preview
  30/10 min/IP; confirmación 12/10 min/IP y 6/10 min/sesión. Configuración por
  el mecanismo existente, sin contadores en memoria; 429 con `Retry-After`.

### DTO exacto del borrador y revisión

`POST /api/v1/web-demands/preview` recibe exclusivamente `{ criteria }`, sin
PII, y normaliza sin persistir. La respuesta contiene
`{ data: { criteria, summary, consent } }`; `summary` es texto construido en
código desde criterios, no por el modelo. `consent` contiene `version`,
`text`, `privacyPolicyVersion` y `reviewStatus`. El preview no concede permiso
para leer o modificar ningún recurso.

```ts
type WebDemandCriteriaV1 = {
  currency: "ARS" | "USD";
  budgetCents: number | null;       // presupuesto TOTAL de compra, no efectivo
  cashCents: number | null;         // efectivo declarado, nunca valor de toma
  maxMonthlyPaymentCents: number | null;
  needsFinancing: boolean | null;
  desiredMakes: string[];
  desiredModels: string[];
  acceptedTypes: ("auto" | "suv" | "pickup")[];
  minYear: number | null;
  maxMileageKm: number | null;
  tradeInDescription: string | null;
  urgencyDays: number | null;
  locality: string | null;
};
```

Todos los campos son obligatorios, usando `null`/`[]` para lo no declarado.
Se rechazan propiedades desconocidas en cada objeto. Importes: enteros
seguros, `budgetCents` y cuota positivos; efectivo admite cero. Nunca se
interpreta efectivo como presupuesto total ni se infiere ninguno desde cuota.
Moneda única para estos importes; no hay conversión. Listas de hasta 10 textos,
trim y máximo 60 caracteres por entrada; canonicalización ordenada y deduplicada
para fingerprint sin alterar el sentido. Año 1950..año servidor+1; km
0..3.000.000; urgencia 0..365; localidad hasta 80 caracteres; descripción de
permuta hasta 200. Al menos marca, modelo, tipo o presupuesto total declarado.
Si financiación es `false`, una cuota declarada contradictoria se rechaza,
no se borra silenciosamente.

El formulario dice que la permuta es una descripción para revisión y que
todavía no se le asignó valor. No recibe appraisalId, simulationCode, leadId,
passportId, token de otro circuito ni importes de un vehículo de stock.
La integración con tasación/simulación es una vertical posterior.

La versión/texto del consentimiento se define en un único módulo de servidor
y se entrega a la UI. Puede versionarse como borrador técnico explícitamente
`reviewStatus: "PENDING_JDA"`, sin fingir aprobación legal; sigue bloqueada la
exposición pública por decisión #7. La versión de política puede ser `null`
si no existe una confirmada; debe coincidir exactamente con lo mostrado y
quedar registrada así. No aceptar una versión arbitraria aportada por cliente.

### Confirmación dedicada y respuesta

`POST /api/v1/web-demands/confirm`, con cookie válida e `Idempotency-Key`
UUID estable por intento, recibe exactamente:

```ts
{
  schemaVersion: "jda.web-demand-confirm.v1",
  expectedVersion: 1,
  criteria: WebDemandCriteriaV1,
  contact: { name: string, phone: string },
  consent: {
    accepted: true,
    version: string,
    privacyPolicyVersion: string | null
  }
}
```

Nombre 2..120 caracteres y teléfono normalizado mediante `normalizePhone`.
No pedir email en este corte. Checkbox nunca preseleccionado y acción
«Confirmar mi búsqueda y pedir contacto» separada del envío de chat. Se vuelve
a normalizar el comando en servidor; no se confía en el preview ni en hashes
del navegador. El texto libre del chat no se envía con esta operación.

Fingerprint SHA-256 canónico de schemaVersion, expectedVersion, criterios
normalizados, nombre normalizado, teléfono normalizado, aceptación y versiones
de consentimiento/política. Se guarda también SHA-256 de `Idempotency-Key`,
con alcance de esta sesión. El fingerprint y la clave nunca se registran en
logs/eventos públicos.

- Primera confirmación válida: 201. Replay misma sesión + clave + comando:
  200 con el mismo recibo e `Idempotency-Replayed: true`.
- Misma clave y otro comando: 409 `IDEMPOTENCY_CONFLICT`, sin escrituras.
- Sesión ya confirmada con otra clave: 409 `WEB_DEMAND_ALREADY_CONFIRMED`;
  permite consultar el recibo, nunca crear otro lead en la misma sesión.
- Cambio de versión: 409 `WEB_DEMAND_CHANGED`. Cambio de consentimiento antes
  del primer alta: 409 `CONSENT_CHANGED`, volver a mostrar y aceptar texto.
  El replay exacto se verifica antes de exigir la versión legal más reciente;
  no invalida un recibo ya creado con evidencia anterior.
- Datos inválidos: 422 `VALIDATION_ERROR`; consentimiento no aceptado:
  422 `CONTACT_CONSENT_REQUIRED`; falla remota: 503 estable sin falso éxito.

Recibo público exacto:

```ts
{
  data: {
    status: "CONFIRMED",
    version: 2,
    demandCode: string,
    createdAt: string,
    validUntil: string,
    contactDelivery: "NOT_SENT"
  },
  meta: { idempotencyReplayed: boolean }
}
```

No devuelve IDs internos, identidad ni enlace con token. Vigencia de demanda
30 días por defecto, `WEB_DEMAND_VALID_DAYS` configurable 7..90; se congela al
confirmar. Urgencia declarada se conserva separada, no crea una vigencia de
años. La UI dice «Tu búsqueda quedó registrada», muestra código/vigencia y
explica que aún no se envió un WhatsApp. No promete respuesta en un plazo.

### Persistencia y transacción

Una tabla nueva `web_demand_session`, sin mensajes y sin identidad:
`id`, `token_hash`, `status` (`ACTIVE|CONFIRMED|REVOKED`), `version`,
`expires_at`, `created_at`, `updated_at`, `confirmed_at`,
`confirmation_key_hash`, `confirmation_command_hash`, `demand_id`.
Hash de token único y de 64 caracteres hex; hashes de confirmación nulos
hasta confirmar; FK de `demand_id` con `ON DELETE RESTRICT` y unicidad.
CHECKs para versión positiva, fechas ordenadas y consistencia: `ACTIVE`
carece de hashes/recibo; `CONFIRMED` tiene ambos hashes, `confirmed_at` y
`demand_id`; revocar no borra el recibo si ya existía. Índice por expiración.
No reutilizar `admin_idempotency`: exige un actor administrativo.

El repositorio nuevo usa `getDb()` y **una única**
`db.transaction(async (tx) => ...)` de Drizzle/postgres-js. El adaptador de
producción ya existe en `db/index.ts`; no escribir otro cliente ni invocar
repositorios con transacciones independientes desde el callback.

1. `SELECT ... FOR UPDATE` de sesión por `token_hash`, sobre el mismo `tx`.
   Validar expiración/revocación; resolver replay/conflicto antes de escribir.
2. Validar estado/version y consentimiento; congelar hora de servidor e IDs.
3. Insertar lead `NEW`, `source: WEB_ADVISOR`, sin buscar/fusionar por teléfono.
   Clave de lead con namespace `web-demand:<session-id>`; command hash del
   comando confirmado. Nunca vincular por un número que el visitante declara.
4. Insertar consentimiento `channel: WHATSAPP_OR_PHONE`,
   `purpose: CONTACT_REQUEST`; evidencia: método `web_demand_confirm`, versión
   del texto, texto exacto aceptado o su snapshot versionado inmutable, estado
   de revisión, versión de política y alcance de contacto por esta búsqueda.
   No implica campañas ni envío automático.
5. Insertar `buyer_passport` DRAFT y actualizar a CONFIRMED dentro del mismo
   `tx`, con todos los criterios de la revisión y `confirmed_at`. Sin
   `conversation_id` ni `review_token_hash`. Guardar efectivo en
   `down_payment_cents` explicitando en el DTO del panel su significado;
   no confundirlo con seña acreditable ni tasación de la permuta.
6. Insertar exactamente una demanda OPEN del pasaporte y el mismo lead,
   criterios normalizados y vigencia congelada. Insertar evento único
   `DEMAND_CONFIRMED_BY_CUSTOMER`, actor CUSTOMER, metadata mínima con código
   y origen, nunca contacto ni hashes.
7. Actualizar sesión a CONFIRMED, versión 2, hashes y FK de demanda. Commit.
   Cualquier excepción revierte todo. El recibo se reconstruye de la demanda
   guardada, no de datos recién calculados durante el replay.

Agregar unicidad `demand(passport_id)` en schema/migración para sostener el
invariante. Antes, comprobar sólo el conteo de duplicados legacy: si existen,
no borrarlos ni elegir un ganador silenciosamente. La migración requiere
resolución explícita de esos registros. Los imports Drizzle tipados evitan
alias camelCase sin comillas. Reusar normalización de criterios sólo donde
su contrato coincide; no reutilizar el fallback `confirmPassport()` seguido
de `createDemand()` porque hace dos commits y no es recuperable.

El borrador anónimo no entra al CRM; su recarga puede perder datos, y la UI lo
avisa. Una confirmación guardada se recupera por cookie/GET mientras la sesión
vive. No implementar recuperación pública por teléfono o código. Las sesiones
vencidas fallan cerradas y su limpieza elimina sólo estado efímero sin tocar
lead, consentimiento, pasaporte, demanda ni eventos comerciales.

### Propiedad de archivos y validación

Luna puede implementar sin claves IA/ML/Zernio, sobre contrato aprobado:

- Dominio/DTO: nuevo `lib/domain/web-demand.mjs`, pruebas de canonicalización.
- Backend: nuevo `lib/data/web-demand-repository.ts`,
  `lib/server/web-demand.ts`, rutas `app/api/v1/web-demands/{session,preview,confirm}`.
- Persistencia: `db/schema.ts`, una migración Drizzle con snapshot/journal;
  incluir tabla en lista de backup/restore de `scripts/d1-backup.mjs` y pruebas.
- UI después del contrato: nuevo componente de revisión/formulario,
  integración localizada en `WebAdvisorChat.tsx`; estado de envío con clave
  estable, reintento, conflicto y recuperación del recibo. Campos de contacto
  no se copian al transcript ni se envían al proveedor de IA.
- Panel: adaptar resumen existente para mostrar criterios completos y moneda;
  autorizar antes de leer y no cambiar la política del panel.

La misma persona/agente posee schema/repositorio hasta cerrar transacción;
nadie edita simultáneamente esa capa. No mezclar reparaciones del asesor
WhatsApp en este commit. Antes de habilitar coincidencias para este origen,
resolver y probar que `acceptedTypes` no se ignora; el motor actual lo almacena
pero no lo utiliza. Condiciones fuera del DTO quedan fuera del corte, no
se anuncian como criterios que se hacen cumplir.

Pruebas exigidas: replay tras respuesta perdida; diez confirmaciones
concurrentes idénticas producen un solo conjunto; dos comandos distintos en
misma sesión dejan un ganador y 409; falla inyectada tras cada INSERT revierte
todas las tablas; cookie alterada/vencida/revocada; CSRF; abuso; esquema de body
estricto; consentimiento cambiado; enteros/monedas; ningún contacto llega al
modelo. Verificar Postgres remoto real con rollback y conteos sobre tablas,
no sólo SQLite o mocks. UI real: edición, loading, error, retry, recarga tras
confirmar y dos pestañas; comprobar que panel y cliente ven el mismo pedido.
Completar suite global, `db:generate` sin drift, restore drill de tabla nueva,
preview Next/Vercel privado con SHA y logs. El mock de IA puede probar el
acople de una propuesta, pero la calidad conversacional queda pendiente de
credenciales y ensayo con proveedor real.
