# Goal Codex — JDA candidata a producción verificable

## Objetivo único

Convertir el estado actual de Jesús Díaz Automotores en una **candidata a
producción honesta, segura, operable y demostrable**, sin agregar nuevas
features. Primero se debe cerrar correctamente la consignación virtual que está
en curso; después hay que reconciliar código, migraciones, datos reales,
documentación, entorno alojado y recorridos completos. No declarar la V1 lista
ni desplegar una nueva versión hasta que cada criterio de salida tenga evidencia
directa.

La propuesta central sigue siendo:

> usado + efectivo + cuota = qué auto te podés llevar hoy

Consignación virtual no reemplaza ni diluye ese producto. Debe quedar
explícitamente clasificada como V1.1 u opcional, o detrás de una bandera hasta
que JDA apruebe su operación comercial.

## Estado de partida que Codex debe respetar

Auditoría del 21 de agosto de 2026:

- El `HEAD` local es `71a8e5b` y contiene siete commits posteriores a la última
  versión publicada.
- La versión alojada más reciente es la 6, basada en `9d65efd`; por lo tanto,
  PWA, fotos privadas de tasación, página pública de simulación, backup,
  accesibilidad y embudo todavía no están publicados.
- Hay trabajo local sin commit de consignación virtual. No descartarlo, no
  resetearlo y no mezclarlo con cambios ajenos.
- El estado local actual compila y pasa 206 pruebas, TypeScript y ESLint sin
  errores. ESLint informa cuatro advertencias por imágenes; hay que resolverlas
  o justificarlas de manera localizada.
- `drizzle/0008_consignment_virtual.sql` fue escrito manualmente, pero falta el
  snapshot Drizzle correspondiente. En este estado, `npm run db:generate`
  intenta generar otra migración duplicada. Esto es un bloqueo de publicación,
  no una advertencia cosmética.
- El entorno alojado no tiene variables configuradas: falta, como mínimo,
  resolver `PANEL_ALLOWED_EMAILS` y `NEXT_PUBLIC_SITE_URL` con datos confirmados.
- La D1 alojada contiene datos demo y un `whatsapp_e164` cargado, mientras la
  documentación dice que el número aún debe confirmarse. Esa contradicción se
  debe resolver con JDA; no inferir la respuesta.
- Siguen pendientes decisiones comerciales: fuente y frescura de stock,
  tarifarios reales, casos dorados, textos legales, cuentas del panel, comisión
  y contrato de consignación.

## Regla principal de ejecución

**No sumar ideas nuevas.** Todo trabajo debe cerrar una brecha comprobada entre
el estado actual y una candidata a producción. Si aparece una idea atractiva,
registrarla fuera del alcance como backlog; no implementarla.

## Mecánica de trabajo Sol / Luna

### Sol — contratos y riesgo alto

Asignar a Sol únicamente tareas con invariantes, seguridad o persistencia:

- migraciones y compatibilidad D1;
- idempotencia y transacciones;
- autorización de cargas privadas;
- ciclo D1/R2 y recuperación ante caídas;
- límites de abuso y rate limiting;
- contratos API, estados y errores estables;
- datos reales/demo, snapshots y reglas comerciales;
- backup, restauración, auditoría y pruebas reales de Worker.

Sol debe congelar el contrato antes de que la interfaz se adapte. Nunca delegar
la interpretación de estas instrucciones: el agente principal debe leerlas y
verificar la integración.

### Luna — interfaz sobre contratos congelados

Asignar a Luna tareas visuales y repetibles una vez estable el contrato:

- refactor legible de formularios;
- estados de carga, reintento, error y éxito;
- navegación móvil, foco, teclado y blancos táctiles;
- previews de fotos y liberación de object URLs;
- microcopy honesto y consistente;
- responsive y recorridos del cliente/panel;
- SEO y metadata cuando el contenido definitivo esté confirmado.

Luna no modifica esquemas, reglas, permisos, dinero ni estados de negocio.

### Agente principal

El agente principal integra, revisa cruces entre capas, ejecuta las pruebas
globales, controla el worktree, crea commits coherentes y es el único que puede
publicar con Sites.

## Fase 1 — cerrar o aislar consignación virtual

No considerar la consignación terminada sólo porque sus pruebas actuales
pasen. Resolver estas brechas antes de commit:

1. **Autorización de carga.** Un código público `CON-XXXXXX` de 24 bits no es
   autorización suficiente para subir fotos. Al crear la consignación, generar
   un token aleatorio de al menos 256 bits, guardar sólo SHA-256 y exigirlo como
   bearer para cada foto. Código inexistente, token incorrecto y registro legacy
   deben responder de forma indistinguible y fail-closed. Nunca poner el token
   en URL, logs, D1 en claro ni respuestas posteriores.
2. **Alta coherente.** Lead, consentimiento y consignación deben crearse como un
   único caso de uso idempotente. Una caída entre requests no puede dejar un
   lead huérfano ni duplicar la oferta. La misma clave y el mismo comando
   reproducen; la misma clave con otro comando devuelve 409 sin escrituras.
3. **Claves estables en cliente.** No generar una idempotency key nueva en cada
   `fetch`. Mantener una clave estable por alta y otra por cada captura durante
   todos los reintentos del mismo intento.
4. **Ciclo D1/R2 recuperable.** Modelar media como
   `PENDING → READY | FAILED → ARCHIVED`, con versión, request hash y timestamps.
   Sólo `READY` se lista o entrega. Una caída después de reservar D1, después de
   escribir R2 o antes de confirmar D1 debe poder reanudarse o compensarse sin
   afirmar éxito falso. Agregar reconciliación para PENDING/FAILED antiguos.
5. **Finalización real.** El servidor, no sólo la UI, debe exigir exactamente
   las cinco capturas READY antes de permitir `SUBMITTED → IN_REVIEW`.
6. **Migración correcta.** Reemplazar la migración manual duplicable por una
   migración Drizzle coherente con su snapshot y journal. Aplicar de cero toda
   la cadena, aplicar sobre una base en 0007 y demostrar que una segunda corrida
   no hace nada. `npm run db:generate` debe responder “sin cambios”.
7. **Privacidad.** Mantener R2 privado, limpieza de EXIF en servidor, límites
   streaming y lectura exclusiva del panel. Probar que el código público solo,
   URLs adivinadas, media no READY y registros cerrados no entregan bytes.
8. **Interfaz mantenible.** Dividir `ConsignmentForm.tsx` en componentes y
   helpers legibles; evitar el archivo de una sola línea. Revocar cada
   `URL.createObjectURL`, preservar archivos/reintentos parciales y explicar qué
   falta sin perder datos. Si `<img>` es necesario para blobs privados, justificar
   localmente la excepción; no silenciar la regla global.
9. **Decisión de producto.** Marcar consignación como V1.1/feature opcional hasta
   que JDA confirme comisión, contrato, retiro de unidad y tratamiento del
   precio esperado. Si no hay confirmación, no mostrarla en la navegación de la
   candidata V1.

Evidencia mínima de fase 1:

- pruebas de token, replay, conflicto, cuota, slots y estados;
- pruebas de fallos inyectados entre D1/R2 y recuperación;
- migración limpia, incremental y repetible;
- flujo real en Wrangler con D1/R2;
- pruebas de autorización administrativa antes de leer PII o bytes;
- TypeScript, ESLint y build verdes.

## Fase 2 — reconciliar el alcance y la verdad comercial

1. Declarar una sola verdad de alcance entre `PLAN_MAESTRO_V1.md`, README,
   `PUERTAS_DE_SALIDA.md` y la navegación. La V1 original tiene seis
   capacidades; consignación debe quedar explícitamente como V1.1 u opcional.
2. Separar en toda superficie datos `DEMO`, datos confirmados y datos pendientes.
   Ningún fixture debe parecer stock, oferta o financiación real.
3. Crear una matriz `DECISIONES_JDA.md` con, para cada dato: responsable,
   pregunta concreta, valor actual, evidencia de confirmación, fecha y efecto de
   no tener respuesta.
4. Incluir como decisiones obligatorias:
   - fuente de stock y minutos de frescura;
   - stock y fotos reales iniciales;
   - financieras, tasas, gastos, plazos y vigencias;
   - al menos cinco operaciones doradas anonimizadas;
   - número E.164 y modalidad de WhatsApp;
   - horarios, mapa, dominio, redes y datos legales;
   - versión del consentimiento y política de privacidad;
   - emails y responsabilidades del panel;
   - reglas comerciales de consignación si se habilita.
5. Si el número actual de WhatsApp no está respaldado por confirmación, retirar
   `whatsapp_e164` del entorno/datos de publicación y usar `/contacto`. No
   convertir una suposición previa en dato confirmado.
6. No bloquear el trabajo técnico por decisiones pendientes: dejar adaptadores,
   validadores y estados honestos listos. Sí bloquear la declaración de
   producción y la exposición de condiciones comerciales no confirmadas.

## Fase 3 — endurecimiento transversal

1. **Abuso:** aplicar rate limits del entorno a altas públicas, búsqueda,
   simulaciones, leads, handoffs y fotos. Definir límites por IP/ventana y por
   recurso sin contadores en memoria del Worker. Responder 429 estable.
2. **Permisos:** decidir y documentar si V1 usa una única allowlist o roles
   (`ADMIN`, `SELLER`, `APPRAISER`, `MARKETING`). El código, el plan y la UI
   deben coincidir. Toda lectura/mutación sensible autoriza antes de consultar.
3. **Observabilidad:** logs estructurados sin PII, tokens, hashes de comando ni
   cuerpos binarios. Medir fallas de handoff, media, motor y migraciones. No
   afirmar que existe analítica de eventos que el código todavía no registra.
4. **Entrega confiable:** decidir si click-to-chat alcanza para V1. Si se promete
   entrega a un CRM o proveedor externo, implementar outbox durable; si no,
   corregir el plan y el copy para no prometerlo.
5. **Datos y snapshots:** cliente y vendedor deben seguir viendo el mismo
   snapshot; precio, stock, promoción y tarifario se revalidan antes de guardar.
6. **PWA:** conservar la regla actual: API, stock, precios, ofertas y financiación
   nunca se sirven desde caché offline.
7. **Backups:** incluir todas las tablas nuevas y ejecutar un restore drill
   sobre el esquema completo, no sólo comparar conteos parciales.
8. **Dependencias y plataforma:** no cambiar Vinext/Sites ni agregar servicios
   externos sin una necesidad aprobada. Mantener compatibilidad Worker ESM.

## Fase 4 — prueba comercial y operativa

Preparar una base de preproducción inequívocamente DEMO y ejecutar de punta a
punta, por la interfaz y por API:

1. stock AVAILABLE con foto → ficha → simulación contextual;
2. usado + efectivo + cuota → resultado firmado → snapshot;
3. lead + consentimiento → WhatsApp contextual → panel vendedor;
4. cambio de precio/stock/oferta entre búsqueda y confirmación → 409 y recálculo;
5. oferta vigente y vencida usando hora del servidor;
6. tasación con fotos privadas → revisión → rango y vigencia;
7. consignación completa sólo si la fase 1 y la decisión de producto la habilitan;
8. backup → restauración descartable → equivalencia de registros y archivos
   referenciados;
9. acceso anónimo/denegado al panel y media privada → fail-closed;
10. navegación desde 320, 360, 390, 430, 768 px y escritorio, teclado completo,
    sin overflow, con estados loading/empty/error/offline/stale.

La evidencia debe incluir asserts sobre D1/R2 real de Wrangler. Las pruebas
estáticas de strings complementan, pero no sustituyen, el recorrido.

## Fase 5 — reconciliar local, repositorio y Sites

1. No publicar con worktree sucio.
2. Separar commits por vertical cerrada y conservar autoría/auditoría.
3. Confirmar que todas las migraciones están versionadas y empaquetadas.
4. Comparar el commit local validado con el commit de la última versión Sites.
5. Configurar variables alojadas sólo con valores confirmados. Nunca guardar
   secretos ni datos operativos en `.openai/hosting.json`.
6. Ejecutar backup remoto antes de migrar D1 y ensayar restauración en una base
   descartable.
7. Desplegar primero con acceso privado. Verificar health, rutas críticas,
   migraciones, D1, R2 y logs de Worker.
8. No hacer pública la app ni invitar usuarios externos sin aprobación expresa.
9. Reabrir la misma pestaña de Sites al finalizar; no crear URLs paralelas.

## Comandos de cierre obligatorios

Ejecutar sobre el commit exacto que se va a publicar:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run db:generate
npm run db:drill
git diff --check
git status --short
```

Además:

- build y preview real con Wrangler;
- cadena de migraciones desde cero e incremental;
- pruebas D1/R2 del flujo comercial;
- revisión de logs alojados tras el despliegue;
- comparación del SHA publicado con `HEAD`.

`db:generate` no puede crear una migración inesperada. `git status --short`
debe quedar vacío antes de empaquetar.

## Criterios de finalización del goal

Este goal está completo únicamente cuando:

1. No hay features nuevas en progreso ni cambios sin commit.
2. Consignación está endurecida y aprobada como V1.1, o está aislada/no visible.
3. No existe drift entre schema, migraciones, snapshots y D1.
4. Código, README, plan maestro, puertas de salida y UI describen el mismo
   alcance y los mismos límites.
5. Todas las condiciones comerciales visibles provienen de datos confirmados o
   están marcadas como DEMO; nunca de inferencias.
6. Las decisiones pendientes tienen responsable y bloquean sólo lo que deben.
7. Panel y media privada fallan cerrados y los uploads usan capabilities fuertes.
8. Reintentos no duplican lead, consentimiento, operación, consignación ni media.
9. El recorrido completo fue probado en UI, API, D1 y R2 con evidencia.
10. Backup y restauración del esquema completo fueron ensayados.
11. La versión desplegada corresponde exactamente al `HEAD` validado.
12. Logs de producción no muestran errores nuevos y la URL privada funciona.
13. `PUERTAS_DE_SALIDA.md` distingue con honestidad: resuelto por código,
    confirmado por JDA, pendiente y bloqueante.

Si falta una confirmación comercial, Codex debe entregar el software listo y
la pregunta exacta, pero no marcar la candidata como producción ni inventar la
respuesta.

## Primera acción de Codex

Revisar el diff local de consignación sin modificar trabajo ajeno, crear un
plan corto de integración y cerrar primero los cuatro riesgos críticos:

1. autorización por token;
2. idempotencia estable y alta atómica;
3. lifecycle D1/R2 recuperable;
4. migración 0008 reproducible con snapshot.

No comenzar otra feature hasta completar y verificar esos cuatro puntos.
