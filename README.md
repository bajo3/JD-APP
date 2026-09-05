# Jesús Díaz Automotores

Web/PWA mobile-first para Jesús Díaz Automotores (Tandil), construida sobre
Next App Router. El runtime corre en Vercel; la base de datos es Postgres en
Supabase (`SUPABASE_DB_URL`) y las fotos siguen en Cloudflare R2, compatible
S3, mientras se completa su migración a Supabase Storage.
El contrato y sus puertas están en [MIGRACION_VERCEL.md](MIGRACION_VERCEL.md). La V1 incluye catálogo demo, ficha de
vehículos, tasación preliminar, buscador “¿Qué auto me llevo?”, Oferta JD del
Día, contacto/WhatsApp y un panel operativo protegido. La consignación
virtual está implementada y endurecida, pero clasificada como **V1.1
opcional**: no se navega ni se anuncia hasta que JDA apruebe comisión,
contrato y retiro de unidad (ver
[PLAN_CONSIGNACION_VIRTUAL.md](PLAN_CONSIGNACION_VIRTUAL.md)).

## Estado y advertencia

El estado de las trece puertas de salida antes de producción está en
[PUERTAS_DE_SALIDA.md](PUERTAS_DE_SALIDA.md): qué resuelve el código y qué
sigue dependiendo de una decisión o un dato de JDA. Las decisiones
comerciales pendientes, con responsable y efecto de no tener respuesta, están
en [DECISIONES_JDA.md](DECISIONES_JDA.md).



La aplicación contiene datos demo y estados orientativos. No representa
aprobación financiera, tasación definitiva, disponibilidad comercial ni
condiciones vigentes hasta conectar y validar las fuentes reales del negocio.
Los datos comerciales incluidos siguen marcados como DEMO. El panel permite
mutaciones reales sobre Supabase, siempre con autorización, auditoría,
idempotencia y control de versión; no realiza borrados físicos.

## Requisitos y comandos

Requiere Node.js `>=22.13.0`.

```bash
npm install
npm run dev       # desarrollo local
npm test          # build de producción + pruebas
npm run build     # build de producción Next.js
```

Para revisar un build local, cargá las variables remotas requeridas en un
`.env` ignorado y usá el servidor de Next:

```bash
npm run build
npm start
```

Para mostrar el recorrido completo hace falta una base DEMO fresca. El motor
degrada a "consultar disponibilidad" cualquier unidad cuyo dato supere el umbral
de frescura del perfil (`stock_freshness_minutes`, hoy 1440 minutos), asi que una
base sembrada dias atras devuelve todo como no alcanzable —correcto, pero no se
puede demostrar—. El seed vuelve a sellar el stock, deja un tarifario vigente y
una oferta con vencimiento a 23 horas, todo marcado como ficticio:

```bash
npm run db:seed -- --confirm-demo   # siembra Supabase
npm run db:seed -- --dry-run        # imprime el SQL sin ejecutarlo
```

Como sólo existe una base (Supabase), sembrar exige el flag explícito
`--confirm-demo`. Estos datos nunca son fuente comercial: cada condición se
muestra marcada como DEMO.

### Stock real desde JD-Auto

`npm run stock:sync` reemplaza el stock DEMO por unidades reales, cruzando tres
fuentes del proyecto hermano JD-Auto (por defecto `../JD-Auto` junto a este
repositorio; `--jd-auto <ruta>` para otra ubicacion): la planilla publicada es
la verdad del precio y la moneda, Supabase aporta la identidad de la unidad, y
el disco local las fotos originales. Una unidad sin precio legible, sin
moneda declarada, sin año, sin kilometraje, sin version o sin fotos originales
se rechaza con su motivo y no se publica — el comando imprime la lista
completa de publicables y de rechazadas.

```bash
npm run stock:sync -- --dry-run                    # imprime el resultado sin escribir
npm run stock:sync -- --confirm-remote             # publica en Supabase y en R2
```

`--photos <n>` cambia el tope de fotos por unidad (12 por defecto, hasta 40);
`--skip-photos` sincroniza solo los datos. Como sólo existe una base, escribir
exige el flag explícito `--confirm-remote`. Cada corrida es idempotente por el
hash del payload: una unidad sin cambios no vuelve a escribirse ni a resubir
fotos.

El stock DEMO no se borra: al publicar la primera unidad real conviene
archivar manualmente las unidades `DEMO_SEED` desde el panel (o con
`UPDATE vehicle SET status='ARCHIVED' WHERE source='DEMO_SEED'`) para que la
web no mezcle datos reales con ficticios.

Las migraciones Drizzle se generan con:

```bash
npm run db:generate
```

## Base de datos: migraciones, backup y restauracion

Los comandos de mantenimiento hablan directo con Supabase por
`SUPABASE_DB_URL` (Postgres puro, sin binarios externos: sólo el paquete
`postgres`). No requieren un build ni un proceso separado, y como sólo existe
una base real, cada comando que escribe pide su propio flag de confirmación
explícito.

Las migraciones se generan con Drizzle y se aplican con un script que registra
cada archivo en `schema_migrations`, asi que el comando es repetible:

```bash
npm run db:migrate -- --confirm-remote
```

Una base creada antes de esa tabla se marca una sola vez con
`node scripts/d1-migrate.mjs --confirm-remote --baseline <id_de_migracion>`;
`--dry-run` lista lo pendiente sin escribir ni pedir confirmación.

El backup vuelca cada tabla a `backups/` (ignorado por git: son datos reales)
en orden de dependencia (una fila nunca se inserta antes que la fila a la que
referencia), como sentencias `INSERT` de Postgres:

```bash
npm run db:backup
```

El ensayo de restauracion vuelca los datos, los restaura en un esquema de
Postgres descartable (creado y eliminado en la misma corrida, nunca toca
`public`) y compara los conteos de todas las tablas del snapshot Drizzle;
falla si falta una tabla o un conteo difiere. Este control no demuestra
igualdad de contenido ni restauración de bytes en el object storage:

```bash
npm run db:drill
```

Para restaurar de verdad hace falta el flag explicito, porque sobrescribe
todas las tablas de la base real:
`node scripts/d1-backup.mjs --restore backups/<archivo>.sql --confirm-restore`.

## Variables de entorno

```env
# obligatorio para Preview y Production en Vercel
NEXT_PUBLIC_SITE_URL=https://tu-dominio-confirmado.example

# allowlist del panel, separada por comas; configurar en el entorno de hosting
PANEL_ALLOWED_EMAILS=equipo@dominio-confirmado.example
# IDs internos de cuentas confirmadas por JDA; nunca aprobar por email solamente
PANEL_ALLOWED_ACCOUNT_IDS=

# opcionales; límites de abuso por IP y ventana (tope o tope/minutos).
# Valores por defecto: búsqueda 30/10m, simulación 30/10m, lead 10/10m,
# handoff 10/10m, tasación 10/30m, foto de tasación 30/30m,
# consignación 6/60m, foto de consignación 30/60m.
RATE_LIMIT_PUBLIC_LEAD=10/10
RATE_LIMIT_PUBLIC_CONSIGNMENT_PHOTO=30/60

# cuenta del cliente: alta 5/60m, ingreso 12/10m
RATE_LIMIT_PUBLIC_ACCOUNT_REGISTER=5/60
RATE_LIMIT_PUBLIC_ACCOUNT_LOGIN=12/10

# opcional; revisión/compensación de reservas de fotos de consignación.
# Valor por defecto: 60 minutos (rango permitido: 1 a 10080).
CONSIGNMENT_MEDIA_STALE_MINUTES=60

# puente de mensajería (Zernio): secreto del webhook, mínimo 16 caracteres.
# Sin él, POST /api/v1/webhooks/zernio responde 503 y no acepta ningún evento.
ZERNIO_WEBHOOK_SECRET=

# clave de API del puente para enviar. Sin ella no sale ningún mensaje.
ZERNIO_API_KEY=
# opcional; por defecto https://zernio.com/api
ZERNIO_API_BASE_URL=

# asesor conversacional (Claude). Sin clave, el asesor responde 503 y la
# conversación queda en atención humana.
ANTHROPIC_API_KEY=
```

No inventar ni publicar un dominio, correo o condición comercial. El panel
requiere una sesión válida de la cuenta propia y el guard de acceso configurado
para el entorno: tener cuenta no concede acceso interno sin estar en la
allowlist de correos y en `PANEL_ALLOWED_ACCOUNT_IDS`. El registro no verifica
correo: JDA debe confirmar la titularidad de la cuenta por un canal conocido
antes de habilitar su ID. V1 usa una única política de administradores:
todos los correos habilitados operan todo el panel, con auditoría por actor;
los roles por función quedan para una versión posterior si el equipo crece.

Las mutaciones públicas (búsquedas, simulaciones, leads, handoffs, tasaciones,
consignaciones y sus fotos) pasan por un limitador de abuso por IP con ventana
fija persistido en Supabase —sin estado en memoria de la función serverless—
que responde `429` estable con `Retry-After` cuando la ventana se agota.

`POST /api/v1/webhooks/zernio` queda fuera de ese limitador a propósito: el
proveedor entrega desde un puñado de direcciones y un tope por IP castigaría
una ráfaga legítima de eventos. Lo que autoriza ahí es la firma
`X-Zernio-Signature` (HMAC-SHA256 del cuerpo crudo), comparada en tiempo
constante; sin secreto configurado el endpoint responde `503` y no acepta nada.

## Rutas públicas

- `/` — propuesta central, filtros, oferta y vehículos destacados.
- `/stock` — catálogo demo.
- `/autos/[slug]` — detalle de un vehículo.
- `/tasar-mi-usado` — flujo de lead + tasación preliminar.
- `/que-auto-me-llevo` — búsqueda de accesibilidad económica orientativa.
- `/oferta-del-dia` — Oferta JD del Día y contador visual.
- `/contacto` — contacto y handoff a WhatsApp cuando está configurado.
- `/simulaciones/[codigo]` — snapshot congelado de una operación simulada,
  de solo lectura y `noindex`; muestra los mismos importes que ve el vendedor.
- `/offline` — pantalla estática que sirve el service worker sin conexión.
- `/cuenta/crear` y `/cuenta/ingresar` — alta e ingreso de la cuenta del
  cliente. `noindex`.
- `/cuenta` — pantalla privada: datos, preferencias, favoritos, búsquedas
  guardadas, tasaciones y simulaciones. `noindex, nofollow`.

Rutas V1.1 opcionales (fuera de la navegación V1 hasta aprobación de JDA):

- `/consignar-mi-auto` — consignación virtual: alta atómica con token de
  carga de 256 bits, cinco fotos guiadas con lifecycle recuperable y revisión
  del equipo antes de ofrecer la unidad. `noindex`.

## Cuenta del cliente

La cuenta es **opcional por diseño**: el catálogo, la ficha, la tasación, el
buscador, la simulación y el contacto funcionan igual sin registrarse, tal como
exige el plan maestro. Registrarse sólo agrega persistencia de lo que la
persona ya hizo: datos de contacto, presupuesto y cuota máxima, marcas y tipo
de vehículo preferidos, vehículo actual declarado, favoritos, búsquedas
guardadas y el seguimiento de sus tasaciones y simulaciones.

Cómo se protege:

- La contraseña nunca se guarda: se deriva con PBKDF2-HMAC-SHA256 y sal
  aleatoria por cuenta. Cada fila conserva su número de iteraciones, así que
  subir el costo no invalida las cuentas viejas: se rehashean al ingresar.
- La sesión es un token de 256 bits en cookie `HttpOnly`, `SameSite=Lax` y
  `Secure` fuera de localhost. De la base sólo sale su SHA-256.
- El ingreso responde lo mismo ante correo inexistente y contraseña incorrecta,
  así que no se puede averiguar qué correos están registrados.
- Ocho intentos fallidos bloquean la cuenta quince minutos; en paralelo, el
  alta y el ingreso pasan por el limitador por IP.
- Cambiar la contraseña revoca las demás sesiones abiertas.
- Las rutas privadas fallan cerradas: sin cookie válida responden 401 sin
  distinguir si la sesión venció, fue revocada o nunca existió.

La actividad (tasaciones y simulaciones) se muestra sólo cuando la cuenta está
vinculada a un lead; sin vínculo la pantalla lo dice en lugar de mostrar la de
otra persona. **Todavía no hay recuperación de contraseña ni verificación de
correo**: ambas necesitan un proveedor de envío que el negocio no definió (ver
[DECISIONES_JDA.md](DECISIONES_JDA.md) #10).

Las rutas viven bajo `/api/v1/account/**`.

Para habilitar un operador, confirmar con esa persona su cuenta y obtener su
ID de una consulta administrativa autorizada a Supabase. No aprobar automáticamente
una cuenta encontrada por email: puede haber sido registrada por otra persona.
Configurar ID y correo en el entorno correspondiente y probar acceso, rechazo
de otra cuenta y cierre de sesión. No registrar los valores en Git ni en logs.

## Panel interno

- `/panel` — resumen operativo, embudo comercial y desgloses por canal, vehículo y responsable calculados desde Supabase.
- `/panel/conversaciones` — cola multicanal, asignación, seguimiento interno y respuesta manual.
- `/panel/leads` — pipeline y cambios de etapa.
- `/panel/stock` — alta y ciclo de publicación del inventario.
- `/panel/tasaciones` — revisión humana y aprobación de rangos.
- `/panel/consignaciones` — ofertas de consignación virtual: fotos privadas y
  decisión de aceptación.
- `/panel/financiacion` — versiones, tramos y publicación de tarifarios.
- `/panel/ofertas` — creación, programación y ciclo de promociones.

Las rutas protegidas viven en `/api/v1/admin/**`. Las altas usan
`Idempotency-Key`, las ediciones usan `expectedVersion` y cada mutación deja
un registro de auditoría atribuido al usuario interno.

## Estructura relevante

```text
app/                 # páginas, API routes, estados y componentes UI
app/_components/     # header/footer, formularios, cards y countdown
app/panel/            # panel operativo protegido
db/                  # schema/fixtures de persistencia
lib/                 # dominio, casos de uso y acceso a datos
public/              # favicon y assets públicos
MIGRACION_VERCEL.md # contrato y puertas de la migración de hosting
```

La API versionada vive bajo `/api/v1` y está diseñada para ser reutilizable
por una futura app Expo/React Native. La búsqueda de accesibilidad devuelve una
huella determinista por opción; al crear la simulación el servidor recalcula
stock, precio, tasación, promoción y tarifario, y rechaza la operación si cambió
alguna condición.

## Contacto, accesibilidad y SEO

Ningún componente público escribe un teléfono, una dirección ni un enlace de
WhatsApp: header, footer, navegación inferior y fichas leen el perfil del
negocio y, si no está configurado, enlazan a `/contacto`. Cada página pública
empieza con "Saltar al contenido" hacia su `<main id="contenido">` y expone
foco visible para teclado. Los datos estructurados (`AutoDealer` y `Car`) se
emiten sólo con datos confirmados: sin perfil cargado no hay JSON-LD de
contacto y las unidades demo nunca se publican como oferta. El sitemap suma
las fichas de stock publicado y deja fuera `/panel`, `/offline` y los códigos
de operación.

## PWA y offline

`public/sw.js` registra una estrategia explícita por tipo de pedido: las
navegaciones van a red primero y caen en `/offline` si no hay conexión, los
assets estáticos usan cache con revalidación en segundo plano y `/api/**` (y
todo lo que no sea GET) nunca se cachea. El stock, los precios, las ofertas y
las financiaciones jamás se sirven desde caché: sin conexión la web lo dice en
lugar de mostrar datos viejos. Los iconos PNG del manifest se regeneran con:

```bash
node scripts/generate-pwa-icons.mjs
```
