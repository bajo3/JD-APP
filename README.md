# Jesús Díaz Automotores

Web/PWA mobile-first para Jesús Díaz Automotores (Tandil), construida sobre
Next App Router + vinext/Sites. Incluye catálogo demo, ficha de vehículos,
tasación preliminar, buscador “¿Qué auto me llevo?”, Oferta JD del Día,
contacto/WhatsApp y un panel interno con métricas y tablas demo.

## Estado y advertencia

La aplicación contiene datos demo y estados orientativos. No representa
aprobación financiera, tasación definitiva, disponibilidad comercial ni
condiciones vigentes hasta conectar y validar las fuentes reales del negocio.
Las acciones del panel son visuales y no destructivas en esta versión.

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

## Panel interno

- `/panel` — resumen y métricas demo.
- `/panel/leads` — leads demo.
- `/panel/stock` — inventario demo.
- `/panel/tasaciones` — solicitudes demo.
- `/panel/financiacion` — consultas demo.
- `/panel/ofertas` — campañas demo.

## Estructura relevante

```text
app/                 # páginas, API routes, estados y componentes UI
app/_components/     # header/footer, formularios, cards y countdown
app/panel/            # panel interno y vistas demo
db/                  # schema/fixtures de persistencia
lib/                 # dominio, casos de uso y acceso a datos
public/              # favicon y assets públicos
.openai/hosting.json # configuración de Sites y bindings
```

La API versionada vive bajo `/api/v1` y está diseñada para ser reutilizable
por una futura app Expo/React Native. No se implementa service worker todavía.
