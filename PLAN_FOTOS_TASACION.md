# Fotos privadas de tasación

**Estado:** implementado y validado para publicación.

## Objetivo

Completar el Hito 3 del plan maestro: el formulario de tasación admite fotos
guiadas del usado, se almacenan de forma privada y el tasador las revisa dentro
del panel. Ninguna foto de un usado puede ser pública ni conservar metadatos.

## Alcance congelado

- El paso final del formulario `/tasar-mi-usado` ofrece seis espacios guiados:
  frente, atrás, lateral izquierdo, lateral derecho, interior y tablero.
- Las fotos son opcionales; se puede terminar la solicitud sin subir ninguna.
- El cliente re-encodea a JPEG en el navegador antes de enviar (borra
  metadatos y normaliza HEIC), con borde máximo de 2048 px.
- `POST /api/v1/appraisals/{publicCode}/photos` acepta un archivo binario por
  vez con `X-Capture-Type` e `Idempotency-Key`; sin multipart ni URLs.
- Solo acepta `image/jpeg`, `image/png`, `image/webp` y `image/avif`, hasta
  10 MiB, con validación de firma binaria igual que las fotos de stock.
- El servidor elimina metadatos (EXIF/XMP/ICC/comentarios) de JPEG, PNG y
  WebP antes de persistir; el hash guardado corresponde a los bytes limpios.
- La carga solo procede mientras la tasación esté `SUBMITTED`; después del
  envío a revisión la puerta se cierra.
- Un espacio (`capture_type`) admite una sola foto por tasación; reemplazar
  exige otro `capture_type` o queda fuera de alcance.
- Bytes en R2 bajo `private/appraisals/{appraisalId}/{mediaId}`; jamás se
  genera URL pública.
- Metadatos en `appraisal_media` (D1) con idempotencia real por
  `admin_idempotency` scope `appraisal_media.upload` y compensación R2/D1.
- El panel muestra la galería en un detalle protegido
  `/panel/tasaciones/[id]`, servido por
  `GET /api/v1/admin/appraisals/{id}/photos` (DTO) y
  `GET /api/v1/admin/appraisals/{id}/photos/{mediaId}` (bytes privados,
  `no-store`), autorizados en servidor para roles con acceso a tasaciones.

## Fuera de alcance

- Edición, reordenamiento o archivado de fotos desde el panel.
- Borrado físico de fotos.
- HEIC almacenado sin limpiar, thumbnails, IA o detección visual.
- Página pública compartible de simulación, PWA y push.
- Cambios al motor financiero o al circuito de tasación existente.

## Seguridad e invariantes

- La foto se referencia por código público `TAS-…` solo mientras la tasación
  no pasó a revisión; el ID interno nunca se expone al cliente.
- La eliminación de metadatos ocurre en servidor aunque el navegador ya haya
  re-encodeado: nadie puede persistir EXIF mediante la API directa.
- El objeto R2 es privado; la única vía de lectura es la ruta administrativa
  con sesión autorizada.
- Un reintento idéntico no duplica objeto ni fila; la misma clave con otra
  foto devuelve `409 IDEMPOTENCY_CONFLICT`.
- Si R2 o D1 fallan, no queda ni objeto huérfano ni fila sin objeto.

## Criterios de salida

- Flujo formulario → fotos → panel muestra la foto correcta en cada espacio.
- JPEG/PNG/WebP con EXIF se persisten sin metadatos y siguen siendo válidos.
- Anónimo no puede listar ni leer fotos; `GET` público no existe.
- Replay idempotente, captura inválida, tipo/tamaño ilegal y tasación no
  `SUBMITTED` fallan sin escrituras.
- Tests, migración, tipos, lint, build y verificación con D1 real pasan antes
  de publicar.
