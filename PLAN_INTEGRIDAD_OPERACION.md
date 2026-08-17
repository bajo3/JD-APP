# Integridad búsqueda → simulación

**Estado:** implementado y validado para publicación.

## Objetivo

Garantizar que la opción elegida en “¿Qué auto me llevo hoy?” sea exactamente
la operación preliminar que se persiste y se entrega al vendedor. El servidor
vuelve a evaluar stock, precio, promoción y tarifario antes de guardar; nunca
confía en un desglose enviado por el navegador.

## Problema comprobado

La búsqueda pública acepta una tasación declarada T0 y la usa para calcular los
resultados. Al guardar una opción, la ruta de simulaciones ignora esa tasación
declarada salvo que exista un `appraisalCode` persistido. Una unidad mostrada
como alcanzable puede, por lo tanto, guardarse con otro saldo, cuota, plan o
clasificación.

## Contrato congelado

La respuesta de búsqueda incluye:

- `simulationInput`: los criterios normalizados que el servidor evaluó.
- `selectionVersion` en cada resultado: huella SHA-256 canónica del input,
  vehículo, reglas, promoción y desglose elegidos.

La creación de simulación recibe únicamente:

- `vehicleId` y `vehicleSlug`.
- `selectionVersion`.
- `simulationInput` devuelto por la búsqueda.

El servidor recalcula la opción con D1 y su reloj actual. Si la nueva huella no
coincide devuelve `409 OPERATION_CHANGED` y no persiste. Si coincide, guarda el
snapshot recalculado por el servidor, no el desglose del cliente.

## Reglas

- La tasación T0 normalizada se conserva en el recálculo.
- Precio, stock, tarifario y promoción siempre se vuelven a consultar.
- La huella es determinista y no contiene datos personales.
- Un reintento idéntico con la misma clave devuelve la misma simulación.
- Reutilizar una clave idempotente con otra selección devuelve conflicto.
- La UI conserva los criterios y lleva al estado “Las condiciones cambiaron”.
- No se crea una simulación cuando la selección cambió o dejó de ser elegible.

## No alcance

- Fotos de stock o tasación.
- Integraciones con financieras, CRM o WhatsApp Business.
- Carga de condiciones comerciales reales.
- Cambios de diseño generales.
- Migraciones nuevas, salvo que la idempotencia demostrablemente lo exija.

## Criterios de salida

- Tasación aplicada, precio efectivo, saldo, plan, plazo y cuota coinciden entre
  el resultado elegido y la simulación guardada.
- Cambiar precio, disponibilidad, tarifario u oferta produce
  `OPERATION_CHANGED` sin escritura.
- Una búsqueda con usado nunca se persiste como una operación sin usado.
- Los snapshots persisten solo valores recalculados por el servidor.
- Pruebas de dominio/aplicación, API, UI, build, tipos y lint pasan.
