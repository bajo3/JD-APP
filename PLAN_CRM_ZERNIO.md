# CRM unificado y asesor conversacional (puente Zernio)

**Estado:** plan. Nada de esto está implementado todavía. Este documento fija
el alcance, el orden de construcción y —sobre todo— qué le tiene que pasar al
negocio antes de que la primera línea sirva para algo.

La candidata V1 ya tiene un CRM mínimo: `lead`, `lead_interest`, `lead_event`,
`consent`, el panel `/panel/leads` con asignación y motivo de pérdida, y la
analítica del embudo. Lo que falta no es "un CRM", es **la entrada de
conversaciones** y **la capa que convierte charla desordenada en datos
comparables**. Este plan agrega eso y nada más.

## Qué ya existe y no se rehace

| Pieza | Dónde | Se reutiliza para |
|---|---|---|
| Lead con idempotencia, estado, asignación, score y motivo de pérdida | `lead` (0000) | Toda oportunidad, venga del canal que venga |
| Interés y línea de tiempo por lead | `lead_interest`, `lead_event` | Registrar vehículos vistos, simulaciones, permutas |
| Consentimiento con evidencia congelada | `consent` | Alta por WhatsApp con la misma prueba que la web |
| Motor de simulación con tarifario versionado | `lib/domain`, `finance_plan_version` | **La única fuente de cuotas.** La IA no calcula |
| Snapshot congelado de la operación | `simulation` | Lo que se le muestra al cliente y al vendedor es el mismo importe |
| Frescura de stock y degradación honesta | `business_profile.stock_freshness_minutes` | La IA no ofrece una unidad cuyo dato venció |
| Tasación con fotos privadas en R2 y limpieza de metadatos | `appraisal`, `appraisal_media` | La permuta llega por WhatsApp con el mismo circuito |
| Limitador de abuso por IP en D1 | `rate_limit_window` (0010) | El webhook y los envíos salientes entran acá |
| Idempotencia y auditoría del panel | `admin_idempotency`, `admin_audit_log` | Cada confirmación humana queda firmada |
| Analítica del embudo con no-medidos declarados | `lib/server/funnel-data.ts` | Se le suman los canales nuevos sin inventar métricas |

## El puente Zernio: qué permite realmente

Leído de la documentación de la API el 2 de septiembre de 2026
(`docs.zernio.com`). **No verificado todavía contra una cuenta real**: hoy
`accounts_list` responde `No accounts connected`, así que nada de esto se
probó de punta a punta.

- **Inbox unificado** sobre WhatsApp Cloud API, Instagram DM, Messenger,
  Telegram y SMS. Es lo que hace posible el "todo llega al mismo panel" del
  pedido: no hay que integrar cinco APIs, hay una.
- **Modelo conversación-céntrico.** `conversationId` es estable por
  participante y cuenta, y viene en cada webhook. Es la clave por la que se
  cuelga el lead.
- **Webhooks de entrada:** `message.received`, `conversation.started`,
  `message.sent`, `message.delivered`, `message.read`, `message.failed`,
  `reaction.received`, `comment.received`, `review.new`. Los comentarios y
  reseñas cubren el "Instagram, Facebook y portales" del CRM unificado.
- **Firma:** `X-Zernio-Signature` = HMAC-SHA256 hex del cuerpo crudo con el
  secreto del webhook. Se verifica con `crypto.subtle` en el Worker y se
  compara en tiempo constante.
- **Salida:** texto libre sólo dentro de la ventana de 24 horas de WhatsApp;
  fuera de esa ventana hace falta una **plantilla aprobada** por Meta. Reabrir
  una conversación fría es `POST /v1/inbox/conversations` con el número.
- **Límite por destinatario:** WhatsApp rechaza con código `131056` arriba de
  ~10 mensajes por minuto al mismo número. El seguimiento automático tiene que
  espaciar, no ráfagas.

Las tres consecuencias de diseño que salen de ahí:

1. El seguimiento a las 48 horas, el de 30 días y los avisos de coincidencia
   **son plantillas aprobadas o no existen**. Eso es trabajo de JDA con Meta,
   no de código.
2. El evento del webhook trae `id` estable: es la clave de idempotencia
   natural. Un reintento de Zernio no puede duplicar un mensaje ni un lead.
3. `refreshUrl` no viaja en el webhook. Las fotos que llegan por DM se bajan y
   se persisten en R2 privado con el circuito de media que ya existe, o se
   pierden.

## Prerrequisitos que hoy bloquean

Ninguna fase pasa de "código listo" a "funcionando" sin esto:

1. **Cuenta Zernio con al menos una cuenta conectada.** Hoy no hay ninguna.
2. **Número de WhatsApp Business confirmado.** Es la decisión #5, todavía
   abierta: la migración 0009 retiró el número por falta de evidencia y hoy
   toda superficie cae a `/contacto`. Sin número no hay asesor.
3. **Plantillas aprobadas por Meta** para reabrir conversación.
4. **Tarifario real vigente** (decisión #3). El asesor que cotiza con el
   tarifario DEMO le miente al cliente aunque el motor esté bien.
5. **Stock real con frescura confirmada** (decisión #1). Un asesor que
   recomienda sobre catálogo DEMO no se puede publicar.

Mientras falten, el asesor se construye y se prueba **contra la base DEMO**,
con el aviso DEMO que ya llevan todas las pantallas, y no se conecta a un
número productivo.

## Regla de honestidad de la IA

Esto es lo que separa este plan de un chatbot cualquiera, y se hace cumplir por
código, no por prompt:

- **La IA no calcula ni recuerda precios.** Toda cifra que aparezca en un
  mensaje sale de una llamada a herramienta contra el motor y el tarifario
  vigente, y queda congelada en un `simulation` con su código público. Si el
  motor rechaza (`monthly_payment_exceeded`, `vehicle_snapshot_not_current`),
  el asesor dice que no, no busca la vuelta.
- **La IA no elige stock.** Recibe la lista que devolvió la búsqueda real, con
  su frescura. Una unidad vencida se ofrece como "consultar disponibilidad",
  igual que en la web.
- **Toda cifra enviada es citable.** Cada mensaje saliente guarda de qué
  snapshot salió. Si un cliente reclama un número, se puede mostrar cuál se le
  mandó y de dónde salió.
- **Confirmación humana obligatoria** para reservar, comprometer un precio,
  cerrar una permuta o agendar una entrega. La IA prepara, el vendedor firma.
- **Fail-closed:** si el modelo no responde, responde raro o la herramienta
  falla, la conversación pasa a un humano con el hilo completo. Nunca improvisa
  para "no dejar al cliente esperando".
- **La tasación por chat es un rango preliminar**, siempre sujeto a revisión
  física y documental, y se dice en el mismo mensaje.

## Fases

### F1 — Puente de entrada (sin IA) — **ingesta implementada**

`POST /api/v1/webhooks/zernio` verifica la firma en tiempo constante, persiste
el evento crudo y lo normaliza a conversación + mensaje + lead + evento de lead
en un único batch D1. Idempotente por `id` del evento; un evento fallido se
puede reprocesar y uno ya procesado no. Entra al backup y al ensayo de
restauración (35 tablas).

Verificado el 3 de septiembre de 2026 contra el Worker real con Wrangler, la D1
local migrada y una firma HMAC calculada de verdad (no el mock de las
pruebas): sin cuenta dada de alta, el evento entra como `IGNORED` con motivo
`UNKNOWN_ACCOUNT` en `channel_webhook_event` y no crea nada más; con la cuenta
cargada, el mismo evento crea el lead con el teléfono normalizado a E.164, la
conversación en `OPEN` enlazada al lead y el mensaje, y el reintento con el
mismo `id` responde `replayed` sin duplicar ninguna fila. Sigue sin probarse
contra una cuenta Zernio real (`accounts_list` sigue en `No accounts
connected`): esto confirma que el circuito local D1/Worker funciona, no que
Zernio vaya a entregar el mismo payload.

Reglas que hace cumplir hoy, cubiertas por `tests/zernio-webhook.test.mjs`:

- Sin `ZERNIO_WEBHOOK_SECRET` no acepta nada (`503`), y firma ausente o
  incorrecta responden exactamente igual (`401`, byte por byte).
- **No pasa por el limitador por IP**: el proveedor entrega desde pocas
  direcciones y un tope por IP perdería eventos legítimos. La firma es lo que
  autoriza.
- Nada se descarta. Una cuenta que nadie dio de alta en `channel_account`, un
  evento que todavía no manejamos o un acuse de un mensaje que no está en la
  bandeja quedan archivados como `IGNORED` con su motivo y su payload.
- El lead se abre sólo cuando el participante trae teléfono normalizable
  (WhatsApp y SMS). En Instagram el participante es un identificador de
  plataforma y **no se inventa un teléfono**: la conversación queda sin lead
  hasta que una persona la convierta.

Falta de F1: bajar a R2 privado las fotos que llegan por DM —el webhook no trae
`refreshUrl`— y el alta de cuentas del canal desde el panel (hoy la fila de
`channel_account` se carga a mano).

Al final de F1, sin una línea de IA, **el CRM unificado ya funciona**: todo
mensaje de WhatsApp, Instagram o Messenger aparece en el panel, asignado,
con su lead y su historial. Es la fase que más valor entrega por línea escrita.

### F1b — Salida del puente — **implementada**

Un único camino de salida (`lib/server/inbox-outbound.ts`), que usan por igual
el asesor y una respuesta escrita a mano en el panel. Hace cumplir por código
lo que la plataforma cobra o rechaza, cubierto por `tests/inbox-outbound.test.mjs`:

- **Ventana de 24 horas.** Fuera de ella no sale texto libre: sale una
  plantilla aprobada o no sale nada, y el proveedor ni se llama. La ventana se
  mide contra el último mensaje del cliente y sólo rige donde la plataforma la
  impone (WhatsApp y SMS), no en Instagram.
- **Ritmo por destinatario.** Se frena en 8 por minuto y por conversación
  —debajo del tope real de WhatsApp— con el mismo contador D1 del limitador de
  abuso, así que el freno ocurre antes del rechazo `131056` y no después.
- **Cada saliente queda citado.** Se persiste con su autor (`AI` o `SELLER`) y
  con la simulación de la que salieron sus cifras. El webhook `message.sent`
  llega después y **no duplica ni pisa el autor real**: la clave única por
  mensaje del proveedor lo impide.
- **Escalada.** `escalateToHuman` pasa la conversación a atención humana, la
  reasigna si se indica destinatario, conserva al vendedor actual si no, y deja
  el motivo en la línea de tiempo del lead. `handOverToAdvisor` hace lo inverso
  y **se niega si la ventana está cerrada**: no se le entrega al asesor una
  conversación en la que no podría contestar.

Falta: las plantillas concretas —que dependen de la aprobación de Meta— y la
pantalla del panel que dispara todo esto.

### F2 — Bandeja operativa

Pantalla `/panel/conversaciones`: cola por asignación, aviso de no atendida
(SLA), respuesta manual desde el panel, seguimiento programado, motivo de
pérdida. Métricas por canal, vehículo y vendedor sumadas al embudo existente,
con los no medidos declarados como ya se hace hoy.

### F3 — Asesor con herramientas — **capa de herramientas implementada**

`lib/server/advisor-tools.ts` es el único punto por el que el asesor toca el
negocio. Tres herramientas, con `strict: true` y `additionalProperties: false`
para que el modelo no pueda pasar un campo inventado, cubiertas por
`tests/advisor-tools.test.mjs`:

- `buscar_vehiculos` — corre el motor real con el tarifario vigente y devuelve
  **como máximo tres** unidades. El tope se hace cumplir en el código, no en el
  prompt: el modelo no puede nombrar una cuarta porque nunca la recibe. Una
  unidad con el dato de stock vencido sale con `disponibilidad: "consultar"` y
  **sin precio ni cuota**. Los avisos del tarifario DEMO viajan en la respuesta
  en lugar de esconderse. Sin plazos declarados usa los que ofrece el tarifario,
  no una lista escrita a mano.
- `simular_operacion` — congela la operación y devuelve el código público. **No
  recibe importes**: usa los que normalizó la búsqueda. Y sólo acepta una unidad
  que la búsqueda acaba de ofrecer: cambiar el `vehicleId` o el
  `selectionVersion` responde `SELECTION_NOT_FROM_SEARCH` sin tocar la base. Es
  el mismo circuito que usa la web, con la misma idempotencia y el mismo
  snapshot que después abre el vendedor.
- `escalar_a_persona` — pasa la conversación a atención humana por el circuito
  de salida, con el motivo asentado, y le prohíbe al asesor prometer plazos.

`cuotaMaxima` es obligatoria porque el motor no evalúa sin ella: la herramienta
obliga al asesor a preguntarla antes de buscar en lugar de suponerla.

**El bucle del modelo** vive en `lib/server/advisor.ts` (`claude-opus-5`,
thinking adaptativo, esfuerzo medio porque la exactitud no la pone el modelo
sino las herramientas; el prompt y las herramientas se cachean). Devuelve el
texto para el cliente pero **no lo manda**: el envío pasa por el circuito de
salida, que es el que hace cumplir la ventana de 24 horas y el ritmo.

Falla cerrado, y eso está probado (`tests/advisor-turn.test.mjs`): respuesta
vacía, error del modelo, rechazo del modelo o más de cuatro rondas de
herramientas terminan en **escalada a una persona con `reply: null`** —no se le
manda nada al cliente— en lugar de improvisar para no dejarlo esperando. Cuando
el propio asesor escala, el turno termina ahí y no se le vuelve a preguntar al
modelo, así que no puede seguir negociando después de haber entregado la
conversación.

**El circuito está cerrado.** `lib/server/advisor-reply.ts` une lo que entra
con lo que sale: mensaje entrante → turno del asesor → envío por el circuito de
salida, cubierto de punta a punta por `tests/advisor-reply.test.mjs` sobre el
webhook real.

La regla que gobierna todo esto: **el asesor sólo contesta una conversación que
alguien puso en modo asesor.** Las conversaciones nacen en `HUMAN`, así que por
defecto ningún cliente recibe un mensaje de la IA sin que el equipo lo haya
habilitado para esa conversación. Con la ventana de 24 horas cerrada ni se le
pregunta al modelo —no podría hablar—, y sin asesor configurado la conversación
queda marcada para una persona en lugar de quedar muda. La clave de idempotencia
del envío se deriva del mensaje entrante, y un reintento del evento ni llega al
modelo.

Falta de F3: el pasaporte del comprador persistido y mostrado al cliente para
que lo corrija, y las herramientas de permuta y visita.

**Deuda conocida:** el turno del asesor corre dentro del webhook, así que en una
conversación en modo asesor el acuse a Zernio espera al modelo. Mientras el
modo asesor sea opt-in por conversación el impacto es acotado; la salida
correcta es una cola, no un timeout más corto.

### F4 — Pasaporte del comprador y registro de demandas — **modelo y coincidencia implementados**

Tres tablas nuevas (migración 0013): `buyer_passport` con los doce datos del
pedido —presupuesto, anticipo, cuota, deseado y alternativas, año mínimo,
kilometraje máximo, uso, permuta, urgencia, localidad, distancia y condiciones
obligatorias frente a negociables—, `demand` con vigencia y estado, y
`demand_match` que guarda cada coincidencia con su porcentaje y **el registro de
si el cliente respondió, visitó y compró**. Sin ese registro el porcentaje no se
puede calibrar nunca, así que la tabla lo pide desde el primer día.

El pasaporte nace `DRAFT` y guarda `confirmed_at`: **el cliente lo corrige antes
de que se busque a su nombre**, tal como pide el pedido.

`lib/domain/demand-matching.mjs` calcula la coincidencia. El porcentaje no sale
de un modelo: son pesos fijos sobre criterios que el comprador declaró —marca
30, modelo 25, precio 20, año 15, kilometraje 10— normalizados sobre lo
declarado, así que **un dato que no dio no penaliza a la unidad**. Y nunca viaja
solo: cada resultado trae el detalle de qué criterio cumplió y cuál no, que es
lo único que le sirve a un vendedor para decidir a quién llamar.

Tres reglas que hace cumplir (`tests/demand-matching.test.mjs`):

- Lo que la persona **no puede pagar no es una coincidencia peor: no es una
  coincidencia**. Precio sobre presupuesto y año bajo el mínimo excluyen, y una
  unidad excluida no lleva porcentaje.
- **No se convierte moneda.** Una unidad en pesos contra un presupuesto en
  dólares se declara `CURRENCY_MISMATCH` y se excluye: convertir sin una
  cotización acordada sería inventar un precio.
- Un precio desconocido **no se asume dentro del presupuesto**.

El kilometraje descuenta pero no excluye —una unidad con más kilómetros sigue
siendo una conversación posible— y el umbral para molestar a un vendedor es un
parámetro explícito, no un capricho del ranking.

**Persistencia y circuito** (`lib/data/demand-repository.ts`,
`lib/server/demand-matching-service.ts`), cubiertos por
`tests/demand-repository.test.mjs`:

- El pasaporte nace `DRAFT` y **la demanda no se crea hasta que el cliente
  confirma**: el `INSERT` de la demanda lee del pasaporte confirmado, así que la
  regla vive en la base y no en una pantalla. Confirmar dos veces no vuelve a
  contar.
- Cuando entra una unidad, las coincidencias se calculan y se guardan
  **en estado `NEW`, sin avisarle a nadie**. El aviso es una acción aparte que
  aprueba una persona; el sistema prepara el mensaje y no lo manda.
- El mensaje preparado cita marca, modelo y año, y nada más: **la única cifra
  del borrador es el año**. Ni precio, ni cuota, ni promesas de reserva o
  bonificación. Los números los pone el vendedor con una simulación.
- Reevaluar la misma unidad **actualiza** la coincidencia con el dato nuevo en
  lugar de duplicarla.
- El recorrido queda sellado paso a paso —avisado, respondió, visitó, compró—
  con su marca de tiempo y su responsable, y descartar exige decir por qué.
- Una demanda con criterios corruptos se saltea sin romper la evaluación del
  resto: no se adivina lo que quiso decir.

**Pantalla `/panel/demandas`** con el mapa de demanda, la cola de coincidencias
por avisar y las demandas abiertas (`tests/demand-panel-ui.test.mjs`,
`tests/demand-map.test.mjs`):

- El mapa cuenta lo declarado y **nada más**. Una demanda sin presupuesto no se
  reparte en un rango probable: se cuenta aparte como no declarada, y la
  pantalla lo dice ("no se estiman: nadie los dijo"). Sin demandas, el tablero
  se declara vacío en lugar de mostrar ceros con porcentajes.
- Los rangos de presupuesto son **tramos fijos, no cuantiles de la muestra**:
  dos lecturas del tablero en días distintos tienen que ser comparables, porque
  con esto se decide qué unidades comprar.
- Quien acepta dos tipos cuenta en los dos: el tablero responde "cuántos
  aceptarían esto", no "cuántos quieren sólo esto".
- La cola de coincidencias muestra el porcentaje **con qué criterios cumple y
  cuáles no**, y el borrador del mensaje. **No hay ningún botón de envío en la
  pantalla** —una prueba lo verifica—: el borrador se lee y lo manda una
  persona.
- El guard del panel corre antes de tocar la base, verificado por posición en
  el archivo.

**El asesor registra la demanda** con dos herramientas separadas a propósito
(`tests/advisor-demand-tools.test.mjs`):

- `registrar_demanda` deja un pasaporte en borrador y devuelve **un resumen en
  palabras del cliente** que el asesor tiene que leerle. No crea la demanda.
- `confirmar_demanda` la registra, y **sólo acepta el pasaporte que se acaba de
  proponer**: el asesor no puede confirmar una demanda que el cliente nunca
  escuchó. Confirmar dos veces no duplica nada.
- Sin contacto no se registra nada: en Instagram sin teléfono la herramienta
  responde `LEAD_REQUIRED` y el asesor tiene que pedirlo primero.
- La vigencia sale del plazo que declaró el cliente, con un piso de siete días:
  un cliente apurado no deja de existir a los dos días. Sin plazo declarado, 30.
- Un presupuesto de cero no es un presupuesto: se rechaza en lugar de registrar
  una demanda que ninguna unidad puede cumplir.

**El disparador está puesto**: publicar una unidad (`AVAILABLE`) cruza el stock
contra las demandas abiertas y guarda las coincidencias
(`tests/demand-stock-trigger.test.mjs`). Tres cosas que hace cumplir:

- Sólo al **publicar**. Pausar o archivar no cruza nada.
- El cruce **no puede hacer fallar la publicación**: va en `try/catch` y no
  relanza. Si falla, la unidad queda publicada y el panel se pierde esas
  coincidencias hasta el próximo intento; al revés sería peor.
- El servicio de cruce **no importa el circuito de salida**: no tiene con qué
  mandarle nada a nadie aunque alguien lo quisiera.

Estas cuatro pruebas son de **cableado** —leen el código, no ejecutan la ruta
del panel de punta a punta—; el comportamiento del cruce en sí está cubierto por
`tests/demand-repository.test.mjs` sobre una base real.

Con esto el circuito de demandas queda cerrado: el asesor la registra cuando no
hay unidad, el cliente la confirma, entra una unidad y la coincidencia espera en
el panel a que una persona decida avisar.

### F5 — Rango preliminar de permuta — **motor implementado**

`lib/domain/appraisal-range.mjs` calcula el rango sobre un tarifario de
tasación **versionado y cargado por el equipo**. Sin scraping de MercadoLibre
(ver riesgos): un número que se le muestra a un cliente tiene que poder
auditarse y sostenerse, y un precio tomado de un aviso ajeno no cumple ninguna
de las dos cosas.

Cubierto por `tests/appraisal-range.test.mjs`:

- **Se niega a estimar antes que estimar mal.** Sin referencia para esa unidad y
  ese año, con prenda declarada, o con un estado que el tarifario no prevé,
  responde que la tasa una persona y **no devuelve ningún número**.
- **Siempre es un rango, nunca un precio**, y siempre `requiresReview: true`:
  la unidad no se vio. El aviso de que queda sujeto a revisión física y
  documental viaja en la respuesta, no en una pantalla que alguien puede omitir.
- **Se puede auditar**: la respuesta trae la versión del tarifario, la
  referencia de la que partió y cada ajuste con su motivo y su magnitud.
- **Menos kilómetros de los esperados no suma valor.** Un premio por kilometraje
  bajo habría que verlo, no creerlo. El castigo por exceso tiene tope.
- **Más evidencia angosta el rango en lugar de mover el valor**: con la unidad
  vista (T1) el rango se cierra, pero el centro no cambia y sigue exigiendo
  revisión.

Falta de F5: la herramienta del asesor para cotizar por WhatsApp y la carga de
referencias desde el panel. Las referencias son la decisión #15 de JDA.

### F6 — Posventa y referidos

48 horas, 30 días, mantenimiento, reseña, referidos, momento de renovación.
Todo por plantilla aprobada y con baja fácil. Depende entera de F1 y de las
plantillas.

### F7 — Mercado inverso (V2, fuera de esta candidata)

El pasaporte del vehículo, la inspección asistida, la sala de operación, la
prueba a domicilio y la red entre agencias. Como bien dice el pedido, esto se
opera a mano con tres a cinco agencias antes de escribir una plataforma. Lo que
sí conviene tener antes: el mapa de demanda real de F4, que es el activo que
hace posible el resto.

## Decisiones nuevas para JDA

Se agregan a `DECISIONES_JDA.md` cuando arranque F1:

- Cuenta Zernio: quién la contrata y con qué plan.
- Qué plantillas de WhatsApp se aprueban y con qué texto.
- Horario de atención del asesor y qué pasa fuera de horario.
- Vendedor responsable por canal y tiempo máximo sin atender.
- Si la IA puede escribir sola al cliente o siempre revisa un humano al
  principio.
- Vigencia de una demanda antes de darla por fría.
- Fuente legítima de comparables para el rango de permuta.
- Comisión y reglas de la red entre agencias (F7).

## Riesgos declarados

**MercadoLibre.** Raspar el sitio para estimar precios va contra sus términos y
puede cortarse sin aviso; además haría depender un número que se le muestra al
cliente de un dato que no controlamos ni podemos auditar. La V1 no lo hace. Si
JDA quiere ese insumo, el camino es una fuente con permiso de uso, y aun así el
rango sigue siendo preliminar.

**Datos personales.** Una conversación de WhatsApp trae más dato sensible que un
formulario. Rige el mismo criterio que el resto del sistema: consentimiento con
evidencia, mínimo dato necesario, fotos en R2 privado sin metadatos, y nada de
compartir datos del comprador con otra agencia sin permiso explícito (F7).

**Costo por mensaje.** WhatsApp cobra por conversación. Un seguimiento
automático mal calibrado es gasto directo, no sólo molestia.

**La IA como cara del negocio.** Un error de la IA lo paga la reputación de
JDA, no la del proveedor del modelo. Por eso confirmación humana en lo que
compromete y escalada ante cualquier duda.
