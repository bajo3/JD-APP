# Consignación virtual (V1.1)

**Estado:** implementada, endurecida y aislada como capacidad opcional V1.1.
No forma parte de la candidata V1: no aparece en la navegación, la portada ni
el sitemap hasta que Jesús Díaz Automotores confirme comisión, contrato y
retiro de unidad. La ruta `/consignar-mi-auto` sigue existiendo para pruebas y
para habilitarla sin cambios de código cuando se apruebe.

## Objetivo

Que cualquier persona pueda ofrecer su unidad para que Jesús Díaz Automotores
la venda en consignación. La web la guía para sacarle cinco fotos —frente,
atrás, lateral, interior y tablero—, las sube en el momento y el negocio la
revisa desde el panel antes de ofrecerla.

> Consignación virtual: tu auto a la venta en Jesús Díaz sin dejar de usarlo.

## Alcance congelado

- Ruta pública `/consignar-mi-auto` (V1.1, `noindex`) con formulario de tres
  pasos: contacto y consentimiento; datos de la unidad; cinco fotos guiadas.
- `POST /api/v1/consignments` crea **en un único batch D1** el lead (fuente
  `CONSIGNACION_WEB`), el consentimiento y la consignación con código público
  `CON-…`. La misma `Idempotency-Key` con el mismo comando reproduce el alta;
  con otro comando responde `409` sin escribir nada. Una caída entre requests
  no puede dejar un lead huérfano ni duplicar la oferta.
- La respuesta del alta entrega una única vez un **token de carga** aleatorio
  de 256 bits (base64url). De D1 sólo se persiste su SHA-256
  (`consignment.upload_token_hash`); el token no vuelve a aparecer en ninguna
  respuesta, URL, log o fila.
- `POST /api/v1/consignments/{publicCode}/photos` exige el token como
  `Authorization: Bearer` en cada foto. El código público solo no autoriza
  nada: código inexistente, token faltante o incorrecto y registro legacy
  responden exactamente igual (404 indistinguible, fail-closed).
- Un archivo binario por vez con `X-Capture-Type` e `Idempotency-Key`; sin
  multipart ni URLs. El cliente re-encodea a JPEG en el navegador antes de
  enviar y el servidor vuelve a eliminar metadatos antes de persistir.
- Exactamente cinco espacios (`capture_type`): `FRONT`, `REAR`, `SIDE`,
  `INTERIOR` y `DASHBOARD`. La base exige un espacio vivo por tipo con índice
  único parcial (`status <> 'ARCHIVED'`).
- **Lifecycle de media recuperable:** cada foto nace `PENDING` en D1, se
  escribe en R2 y recién entonces pasa a `READY` (guardada por versión). Si R2
  falla queda `FAILED` sin afirmar éxito; reintentar con la misma clave y el
  mismo archivo reanuda el flujo (re-escribe R2 y confirma). Las reservas
  abandonadas se archivan (`ARCHIVED`) por antigüedad, liberan su espacio y su
  posible objeto huérfano, y borran su reserva de idempotencia.
- Sólo `READY` se lista o entrega: el panel y los bytes privados nunca
  exponen filas `PENDING`, `FAILED` o `ARCHIVED`.
- El **servidor**, no sólo la UI, exige exactamente cinco fotos `READY` antes
  de permitir `SUBMITTED → IN_REVIEW`.
- La carga sólo procede mientras la consignación esté `SUBMITTED`.
- Bytes en R2 bajo `private/consignments/{consignmentId}/{mediaId}`; jamás se
  genera URL pública. El panel `/panel/consignaciones` decide
  `SUBMITTED → IN_REVIEW → ACCEPTED | REJECTED` con auditoría, y el detalle
  protegido sirve las fotos por las rutas administrativas (`no-store`).
- El resumen del panel incorpora las consignaciones por revisar.

## Claves estables en cliente

El alta usa una única `Idempotency-Key` guardada en una ref durante todos los
reintentos del mismo intento; cada captura tiene su propia clave, que sólo se
regenera si cambia el archivo. Cada `URL.createObjectURL` se revoca al
reemplazarse o desmontarse el componente. Si el usuario recarga a mitad del
flujo pierde el código y el token: la UI lo advierte y no hay vía de
recuperación por diseño (fail-closed).

## Fuera de alcance

- Publicar la unidad aceptada en `/stock` de forma automática: el precio final,
  la comisión y el contrato de consignación son acuerdo humano. Aceptar una
  consignación la habilita comercialmente; la publicación sigue el circuito
  existente de alta manual de stock.
- Cálculo de comisión, contrato digital, firma o retiro de unidad.
- Edición, reordenamiento o borrado físico de fotos desde el panel.
- Integración con tasación: son circuitos independientes; si el dueño quiere
  además una tasación, usa `/tasar-mi-usado`.
- Cambios al motor financiero, al embudo o al circuito de leads existente.

## Seguridad e invariantes

- El código público `CON-…` identifica; el token de 256 bits autoriza. El ID
  interno nunca se expone al cliente.
- La eliminación de metadatos ocurre en servidor aunque el navegador ya haya
  re-encodeado: nadie puede persistir EXIF mediante la API directa.
- El objeto R2 es privado; la única vía de lectura es la ruta administrativa
  con sesión autorizada del panel, y sólo para fotos `READY`.
- Un reintento idéntico no duplica objeto ni fila; la misma clave con otra
  foto devuelve `409 IDEMPOTENCY_CONFLICT`. Si R2 o D1 fallan, no queda ni
  objeto huérfano sin fila ni fila viva sin objeto.
- El precio esperado del dueño es declarativo: ninguna pantalla lo presenta
  como precio de venta ni compromiso.
- La consignación no crea stock: ninguna unidad en consignación aparece en el
  catálogo público hasta que se publique por el circuito de stock.

## Criterios de salida

- Alta → token → cinco fotos → panel muestra cada foto en su espacio.
- El paso de fotos no finaliza sin las cinco imágenes confirmadas `READY`.
- Sin token, con token incorrecto o registro legacy no se entregan bytes ni
  mensajes distinguibles de un código inexistente.
- Fallo inyectado de R2 deja la fila `FAILED` sin éxito falso; el reintento
  con la misma clave la reanuda hasta `READY`.
- JPEG/PNG/WebP con EXIF se persisten sin metadatos y siguen siendo válidos.
- Anónimo no puede listar ni leer fotos; `GET` público no existe; sólo
  `READY` se entrega.
- Replay idempotente, captura inválida, tipo/tamaño ilegal, espacio ocupado y
  consignación no `SUBMITTED` fallan sin escrituras.
- `SUBMITTED → IN_REVIEW` sin las cinco `READY` falla en servidor.
- `ACCEPTED` no publica nada en el catálogo y queda auditado con responsable.
- Migración 0008 con snapshot Drizzle coherente: `npm run db:generate`
  responde sin cambios; la cadena aplica desde cero e incrementalmente.
- Tests, migración, tipos, lint, build y verificación con base real pasan
  antes de publicar.

## Decisiones comerciales pendientes (bloquean habilitar V1.1)

- Comisión y contrato de consignación.
- Mecanismo de retiro de la unidad.
- Tratamiento del precio esperado del dueño dentro del panel.
