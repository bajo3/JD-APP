# Jesús Díaz Automotores

Web/PWA mobile-first para Jesús Díaz Automotores (Tandil), construida sobre
Next App Router + vinext/Sites. Incluye catálogo demo, ficha de vehículos,
tasación preliminar, buscador “¿Qué auto me llevo?”, Oferta JD del Día,
contacto/WhatsApp y un panel operativo protegido para administrar la V1.

## Estado y advertencia

El estado de las trece puertas de salida antes de producción está en
[PUERTAS_DE_SALIDA.md](PUERTAS_DE_SALIDA.md): qué resuelve el código y qué
sigue dependiendo de una decisión o un dato de JDA.



La aplicación contiene datos demo y estados orientativos. No representa
aprobación financiera, tasación definitiva, disponibilidad comercial ni
condiciones vigentes hasta conectar y validar las fuentes reales del negocio.
Los datos comerciales incluidos siguen marcados como DEMO. El panel permite
mutaciones reales sobre D1, siempre con autorización, auditoría, idempotencia
y control de versión; no realiza borrados físicos.

## Requisitos y comandos

Requiere Node.js `>=22.13.0`.

```bash
npm install
npm run dev       # desarrollo local
npm test          # pruebas configuradas del starter
npm run build     # build de producción Sites/vinext
```

Para datos demo locales, usar las fixtures incluidas por el proyecto y el
seed/local data access configurado en `db/` y `lib/`; no usar estos datos como
fuente comercial. Las migraciones Drizzle se generan con:

```bash
npm run db:generate
```

## Base de datos: migraciones, backup y restauracion

Las migraciones se generan con Drizzle y se aplican con un script que registra
cada archivo en `schema_migrations`, asi que el comando es repetible:

```bash
npm run db:migrate
```

Una base creada antes de esa tabla se marca una sola vez con
`node scripts/d1-migrate.mjs --baseline <id_de_migracion>`; `--dry-run` lista lo
pendiente sin escribir y el entorno remoto exige `--remote --confirm-remote`.

El backup exporta la base a `backups/` (ignorado por git: son datos reales) y
reordena el volcado para que cada fila se inserte despues de crear su tabla,
que es lo que hace restaurable el archivo:

```bash
npm run db:backup
```

El ensayo de restauracion exporta, restaura en una base descartable y compara
los registros de las tablas que sostienen la operacion; falla si alguna no
coincide:

```bash
npm run db:drill
```

Para restaurar de verdad hace falta el flag explicito, porque sobrescribe:
`node scripts/d1-backup.mjs --restore backups/<archivo>.sql --confirm-restore`.

## Variables de entorno

```env
# opcional; si falta, sitemap usa rutas relativas
NEXT_PUBLIC_SITE_URL=https://tu-dominio-confirmado.example

# allowlist del panel, separada por comas; configurar en el entorno de hosting
PANEL_ALLOWED_EMAILS=equipo@dominio-confirmado.example
```

No inventar ni publicar un dominio, correo o condición comercial. El panel
requiere el guard de acceso configurado para el entorno; no se implementa un
login propio en las vistas.

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

## Panel interno

- `/panel` — resumen operativo calculado desde D1.
- `/panel/leads` — pipeline y cambios de etapa.
- `/panel/stock` — alta y ciclo de publicación del inventario.
- `/panel/tasaciones` — revisión humana y aprobación de rangos.
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
.openai/hosting.json # configuración de Sites y bindings
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
