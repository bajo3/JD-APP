# PWA offline seguro

## Objetivo

Iniciar el Hito 8: que la web sea instalable y que la experiencia offline sea
honesta. Nunca se trata como verdad cacheada el stock, un precio, una oferta
ni una financiación.

## Alcance congelado

- `public/sw.js` con estrategia explícita por tipo de pedido:
  - Navegaciones: red primero; si falla, página cacheada o `/offline`.
  - Assets estáticos (estilos, scripts, fuentes, imágenes): cache con
    revalidación en segundo plano.
  - `/api/**` y todo lo que no sea GET: red directa, sin caché.
- `/offline` como pantalla estática sin acceso a base de datos.
- Banner superior "Sin conexión" controlado por los eventos `online/offline`,
  con `aria-live` respetuoso.
- Registro del service worker desde el layout raíz.
- Iconos PNG reales (192, 512 y apple-touch 180) generados desde la marca de
  la favicon, con variante `maskable` de fondo sólido.
- `manifest.ts` ampliado con los PNG y layout con `apple-touch-icon` y
  `theme-color`.

## Invariantes

- El service worker jamás cachea respuestas de `/api/`.
- La pantalla offline no promete disponibilidad ni precios.
- El precache de `/offline` falla silenciosamente si el servidor no responde.
- La versión del cache incluye un identificador que cambia al tocar `sw.js`.

## Criterios de salida

- `/sw.js`, `/offline` y los PNG se sirven correctamente.
- Con red cortada, una navegación cae en `/offline`; los assets cacheados
  siguen funcionando; los pedidos de API no se sirven desde caché.
- Manifest válido con iconos `any` y `maskable`.
- Tests, build y verificación en Workers reales pasan antes del commit.
