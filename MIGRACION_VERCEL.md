# Migración a Vercel

## Estado

**En curso; no desplegar todavía.** GitHub (`bajo3/JD-APP`, rama `main`) es la
fuente canónica. Vercel será el único hosting cuando se cumplan las puertas de
esta guía. No usar ni publicar ChatGPT Sites ni tocar `meli-app`. No crear ni
vincular el proyecto hasta completar las correcciones y contar con el entorno
confirmado. La publicación será por GitHub, sin `vercel deploy`/`vercel --prod`.

El comando `npm run build` valida de forma automática que cualquier build de
Vercel tenga panel, D1 y R2 configurados. Si falta una de esas variables, el
build falla antes de publicar; fuera de Vercel la comprobación se omite para
que las pruebas aisladas no requieran secretos. Zernio y Anthropic permanecen
opcionales: sus endpoints se cierran con `503` cuando no están configurados.

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
  `PANEL_ALLOWED_EMAILS` y `PANEL_ALLOWED_ACCOUNT_IDS`. Ambos deben coincidir.
  El registro no verifica email: habilitar únicamente IDs cuya titularidad
  confirmó JDA, nunca autoaprobar por el correo declarado. Las cabeceras de
  ChatGPT no son una identidad válida.
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
- Sin esas credenciales, el servidor Next responde `503 PERSISTENCE_UNAVAILABLE`
  para datos de negocio: no cae a fixtures ni expone una demostración como si
  fuera producción.

## Variables que deberá recibir Vercel

No cargar valores hasta crear el proyecto compatible. Los nombres previstos
para los adaptadores son:

```env
PANEL_ALLOWED_EMAILS=
PANEL_ALLOWED_ACCOUNT_IDS=
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

## Plan del corte de corrección

Sol auditó y congeló los contratos; Luna ejecuta con revisión de Sol y del
agente principal. El objetivo activo es cerrar la migración verificable, sin
agregar capacidades comerciales:

1. Autorización: ID de cuenta habilitado + correo, incluyendo regresión del
   alta pública que declara un correo interno.
2. Tooling D1/R2 sin `dist/server` de Vinext: migración, seed, backup y drill
   reproducibles desde un checkout limpio; sin tocar fuentes comerciales.
3. D1 remoto: rechazar resultados ausentes o lotes incompletos en lugar de
   fabricar éxito. Mantener el formato oficial `{batch: [...]}`.
4. Rate limit: identificar al cliente mediante cabeceras confiables de Vercel,
   sin un cupo global `unknown` ni confiar en una cabecera Cloudflare del cliente.
5. Fotos: límite compartido compatible con Functions para entrada y salida,
   conservando autorización, validación de bytes y lifecycle D1/R2.

### Evidencia y límites

- Base del corte: `7c18cb7`, worktree limpio y coincidente con `origin/main`.
- `npm test` inicial: build y 419 pruebas en verde.
- Drill inicial: 36 tablas con conteos coincidentes, usando configuración
  residual de Vinext. No demuestra reproducibilidad de un checkout nuevo ni
  equivalencia de contenido, y no valida la API remota.
- Las nueve variables originales obligatorias están ausentes de `.env` y
  del proceso; `.env.local` y el vínculo `.vercel` no existen. La nueva variable
  de IDs tampoco tiene cuentas confirmadas. Se verificaron sólo nombres.
- Credenciales D1/R2, acceso real, preview protegido y logs remotos pendientes.
- Comprobación HTTP del build inicial en Next local: catálogo 503
  `PERSISTENCE_UNAVAILABLE`; resumen del panel y foto privada anónimos 401;
  cuenta sin sesión 401. El navegador muestra un error recuperable sin datos
  ficticios y `/panel` redirige al ingreso. No se pudo probar el recorrido
  autenticado por falta de persistencia remota.
- Consulta de metadata con Wrangler sobre la D1 local, usando la configuración
  de datos fuente: cero registros mayores a 4 MiB en `vehicle_media`,
  `appraisal_media` y `consignment_media`. La revisión remota sigue pendiente.

## Puertas y orden de publicación por GitHub

1. El build Next.js funciona sin bindings de Workers, Vinext ni Sites.
2. D1 remoto debe pasar pruebas de consulta, lote, conflicto e idempotencia.
3. R2 remoto debe pasar uploads, compensación y entrega privada de fotos.
4. El panel debe probar sesión propia, ambas listas, denegación y cierre de sesión.
5. Deben pasar `npm test`, lint, TypeScript, `db:generate`, restore drill y una
   prueba manual de rutas críticas contra el entorno privado.
6. Con las credenciales confirmadas y las pruebas locales completas, crear el
   proyecto dedicado `JD-APP` (si Vercel exige minúsculas, `jd-app`), verificar
   que pertenece a `bajo3/JD-APP` y configurar Preview/Production. No copiar
   valores a Git ni reutilizar el proyecto `meli-app`. Zernio y Anthropic son
   opcionales: no invocarlos ni gastar sin autorización explícita.
7. Antes del primer despliegue comprobar Deployment Protection y mantener
   producción detenida. Generar el preview desde una rama GitHub. Un nombre de
   rama o una URL difícil de adivinar no reemplazan la protección de acceso.
8. Probar lectura D1, lote atómico/replay/conflicto, subida R2, lectura privada,
   fallos intermedios, límites, sesión y logout. Auditar metadata de fotos
   existentes que superen el nuevo límite de respuesta; no declarar cerrado
   el recorrido mientras esos objetos sigan sin resolver.
9. Sólo con el preview validado habilitar pushes de `main` para producción.
   Conservar acceso privado hasta autorización expresa para hacerlo público.
   Confirmar SHA GitHub = SHA desplegado, URL y logs sin errores nuevos.

Fuentes de plataforma: [Vercel + GitHub](https://vercel.com/docs/git/vercel-for-github),
[Next.js en Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs) y
[API S3 de R2](https://developers.cloudflare.com/r2/get-started/s3/).
Contratos corroborados para este corte:
[lotes D1](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/),
[cabeceras de Vercel](https://vercel.com/docs/headers/request-headers),
[límites de Functions](https://vercel.com/docs/functions/limitations) y
[Deployment Protection](https://vercel.com/docs/deployment-protection).
