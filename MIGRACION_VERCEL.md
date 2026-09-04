# Migración a Vercel

## Estado

**En curso; no desplegar todavía.** GitHub (`bajo3/JD-APP`, rama `main`) es la
fuente canónica. Vercel será el único hosting cuando se cumplan las puertas de
esta guía. No se crea un proyecto, no se vincula el checkout y no se ejecuta
`vercel --prod` antes de completar y verificar los adaptadores.

## Contrato congelado

- El runtime final será Next.js sobre Vercel; no habrá Vinext, Worker ni
  ChatGPT Sites en la ruta de producción.
- La base de datos conserva D1 durante esta migración. Un adaptador de servidor
  para la API remota de D1 debe implementar el contrato que hoy consumen los
  repositorios (`prepare`, `bind`, `first`, `all`, `run` y `batch`) sin cambiar
  el SQL, las transacciones lógicas ni las migraciones existentes.
- Los objetos permanecen privados en R2. El adaptador de servidor usará la API
  S3 de R2 con un token restringido al bucket; los bytes privados sólo salen
  después de la autorización ya existente. No se reemplaza por URLs públicas.
- El panel usa la sesión HttpOnly de las cuentas propias más
  `PANEL_ALLOWED_EMAILS`. Las cabeceras de ChatGPT no son una identidad válida.
- Todos los secretos se cargan sólo en Vercel o en `.env` ignorado. No se
  versionan ni se muestran en logs, pruebas o documentación.

## Avance verificado

- `db/d1-remote.ts` implementa y prueba el contrato D1 contra el endpoint
  remoto oficial: consultas preparadas, parámetros, `first`, `all`, `run` y
  `batch`. Los errores no devuelven SQL, cuerpo del proveedor ni credenciales.
- `lib/data/r2-remote.ts` implementa y prueba el contrato S3 compatible de R2:
  mantiene claves y metadata de stock/piezas privadas, no crea URLs públicas y
  conserva la entrega privada bajo autorización de los servicios existentes.
- El checkout ya usa Next.js 16.3.4: se retiraron Vinext, el Worker, Vite y el
  plugin de Sites. `db/index.ts` y `objectStore` construyen los adaptadores
  remotos sólo al atender una solicitud, por lo que un build no accede a
  secretos ni a datos comerciales.
- El build de producción nativo pasó con Node 24 y todas las rutas de negocio
  quedaron dinámicas; falta probarlas contra un entorno privado que tenga las
  credenciales reales de D1/R2 configuradas.

## Variables que deberá recibir Vercel

No cargar valores hasta crear el proyecto compatible. Los nombres previstos
para los adaptadores son:

```env
PANEL_ALLOWED_EMAILS=
NEXT_PUBLIC_SITE_URL=
ZERNIO_WEBHOOK_SECRET=
ZERNIO_API_KEY=
ZERNIO_API_BASE_URL=
ANTHROPIC_API_KEY=

CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_D1_DATABASE_ID=
CLOUDFLARE_D1_API_TOKEN=
CLOUDFLARE_R2_ENDPOINT=
CLOUDFLARE_R2_BUCKET=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
```

El token D1 y las credenciales R2 se crearán con el mínimo alcance necesario.
Para R2, Cloudflare documenta credenciales S3 con permisos por bucket; no se
reutiliza una clave amplia de cuenta.

## Puertas antes de conectar GitHub con Vercel

1. El build Next.js funciona sin bindings de Workers, Vinext ni Sites.
2. D1 remoto debe pasar pruebas de consulta, lote, conflicto e idempotencia.
3. R2 remoto debe pasar uploads, compensación y entrega privada de fotos.
4. El panel debe probar sesión propia, allowlist, denegación y cierre de sesión.
5. Deben pasar `npm test`, lint, TypeScript, `db:generate`, restore drill y una
   prueba manual de rutas críticas contra el entorno privado.
6. Recién entonces se importa `bajo3/JD-APP` en Vercel, con `main` como rama de
   producción. La integración GitHub generará previews por ramas y despliegues
   de producción por pushes a `main`.

Fuentes de plataforma: [Vercel + GitHub](https://vercel.com/docs/git/vercel-for-github),
[Next.js en Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs) y
[API S3 de R2](https://developers.cloudflare.com/r2/get-started/s3/).
