# Fotos reales de stock

## Objetivo

Completar el circuito panel → R2/D1 → catálogo público para que cada unidad
pueda mostrar fotos reales, manteniendo el fallback visual actual cuando no hay
imágenes.

## Alcance congelado

- Carga protegida desde `/panel/stock`.
- JPEG, PNG, WebP y AVIF; máximo 5 MiB por archivo.
- Validación de tamaño, MIME y firma binaria antes de persistir.
- Bytes en R2 y metadatos relacionales en D1.
- Idempotencia, control de versión y auditoría para altas y cambios.
- Listado, orden de foto principal y archivado lógico.
- Entrega pública únicamente de medios `READY` asociados a vehículos
  `AVAILABLE`.
- Primera foto en tarjetas, oferta y ficha; fallback existente sin foto.

## Persistencia

`vehicle_media` incorpora:

- `byte_size` y `sha256`.
- `status`: `PENDING | READY | ARCHIVED | FAILED`.
- `version`, `uploaded_by`, `updated_at` y `archived_at`.
- unicidad por vehículo + hash.
- índice de lectura por vehículo, estado y orden.

R2 usa claves generadas por servidor bajo `public/stock/<vehicle>/<media>`;
nunca usa el nombre original del archivo.

## Contratos

- `GET/POST /api/v1/admin/vehicles/:id/media`.
- `PATCH /api/v1/admin/vehicles/:id/media/:mediaId` para orden/principal o
  archivado lógico.
- `GET /api/v1/media/vehicles/:mediaId` para entrega pública controlada.

El upload acepta el archivo como cuerpo binario y recibe texto alternativo,
versión del vehículo e idempotencia en encabezados. No acepta multipart ni un
URL aportado por el cliente.

## Consistencia R2 + D1

La operación valida y calcula hash, escribe R2, confirma metadatos/auditoría en
D1 y elimina el objeto como compensación si D1 falla. Los reintentos idénticos
no duplican objeto, fila ni auditoría.

## No alcance

- Fotos privadas de tasaciones.
- HEIC público, video, thumbnails o conversión de formatos.
- Recorte, filtros, marcas de agua o IA.
- CDN o procesador de imágenes externo.
- Borrado físico desde el panel.

## Criterios de salida

- Anónimo no puede cargar, ordenar ni archivar.
- Más de 5 MiB o firma/MIME inválidos devuelve error estable sin escribir.
- Replay deja un objeto, una fila y una auditoría.
- Un conflicto de versión no deja objetos huérfanos.
- Solo `READY + AVAILABLE` entrega bytes con MIME, ETag y `nosniff` correctos.
- Archivar retira la imagen del DTO y de la entrega pública.
- Sin fotos, tarjetas y ficha conservan el fallback actual.
- Build, tipos, lint, migración y pruebas pasan antes de publicar.

