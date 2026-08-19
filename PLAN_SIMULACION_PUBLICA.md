# Página pública de simulación

## Objetivo

Cerrar el recorrido del cliente: quien simuló una operación puede volver a ver
su snapshot con el código `JD-XXXXXX` que la web ya le muestra al confirmar.
Cliente y vendedor ven exactamente la misma operación congelada (criterio 7
del plan maestro).

## Alcance congelado

- Ruta pública `/simulaciones/{codigo}` como Server Component dinámico que
  lee `simulations.findByPublicCode` directamente, sin auto-llamadas HTTP.
- Código inválido o inexistente resuelve `notFound()`; la página no distingue
  "formato inválido" de "no existe" para no regalar información.
- Muestra únicamente el snapshot congelado: vehículo, importes, plazo, cuota,
  costo total, clasificación, certeza, disclaimer, creación y vencimiento.
- Nunca muestra datos del lead (nombre, teléfono, eventos) ni hashes de
  idempotencia; la página es de solo lectura.
- Vigencia evaluada en servidor con la fecha de expiración persistida:
  estado "Vigente" u "Operación vencida" con CTA a volver a simular.
- Si la unidad ya no está publicada, se informa con honestidad y se conservan
  los importes del snapshot; nunca se recalcula precio, promoción ni cuota.
- La ficha del vehículo se enlaza solo si la unidad sigue `AVAILABLE`.
- `noindex` en la página: los códigos de operación no deben indexarse.
- Formato es-AR para importes y fechas (zona America/Argentina/Buenos_Aires).

## Fuera de alcance

- Crear leads o handoffs desde esta página (eso vive en el finder).
- `/mi-operacion/{codigo}` con sesión firmada.
- Recálculo, edición o reenvío de la simulación.
- Cambios en la API de simulaciones.

## Criterios de salida

- Un código válido renderiza los mismos importes que ve el vendedor en el
  panel para esa simulación.
- Código inexistente, vencido o de unidad retirada muestran estados claros y
  honestos sin exponer datos internos.
- La página no lee tablas de leads ni eventos.
- Tests de estructura y de servidor pasan junto con la suite completa.
