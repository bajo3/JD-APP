# Decisiones pendientes de JDA

Matriz de decisiones comerciales requeridas para declarar la candidata a
producción. Cada fila dice quién responde, la pregunta concreta, el valor que
usa el software hoy, la evidencia que contaríamos como confirmación y qué
pasa si no hay respuesta. Nada de esto se infiere: sin confirmación, la
condición queda pendiente y bloquea sólo lo que la última columna dice.

Responsables de referencia: **JDA** = Jesús Díaz (decisión comercial),
**Dev** = quien desarrolla (ejecución técnica una vez decidido).

| # | Tema | Responsable | Pregunta concreta | Valor actual en el software | Evidencia de confirmación | Efecto sin respuesta |
|---|------|-------------|-------------------|-----------------------------|---------------------------|----------------------|
| 1 | Fuente de stock | JDA | JD-Auto quedó confirmado el 14 de septiembre de 2026 como fuente definitiva. Falta definir: ¿con qué cadencia corre la sincronización (a demanda o programada) y qué umbral de frescura se usa? | El importador cruza la planilla comercial, Supabase (schema `jda`) y las fotos originales del proyecto JD-Auto; `stockFreshnessMinutes` es configurable (1440 por defecto) y la corrida sigue siendo manual. | Respuesta escrita con frecuencia y umbral de frescura. | El stock se puede sincronizar de forma segura a demanda, pero no se actualiza solo hasta definir la cadencia. |
| 2 | Stock y fotos iniciales | JDA | ¿Las siete unidades completas actuales son el surtido de lanzamiento? | Sincronización real ejecutada el 14 de septiembre de 2026: siete unidades disponibles con 12 fotos cada una (Fiorino, Honda CRV, Jeep Wrangler, Mercedes CLA, Ram Laramie, Toyota Hilux y VW Amarok). Cincuenta filas quedaron fuera por falta de ficha o datos obligatorios; no se inventan ni se publican incompletas. | Confirmación de esas siete o corrección de las fichas pendientes en JD-Auto. | El catálogo muestra sólo las siete completas y mantiene las demás pausadas, sin borrarlas. |
| 3 | Financiación | JDA | ¿Qué financieras, tasas, gastos, plazos y vigencias se muestran? ¿Se publican tramos reales? | Tarifario DEMO versionado, marcado ficticio en cada pantalla; el motor rechaza operar sin tarifario vigente. | Tarifario real con vigencias firmado o enviado por JDA. | La simulación sigue advirtiendo que usa tarifario DEMO. |
| 4 | Casos dorados | JDA | ¿Cuáles son al menos cinco operaciones reales de referencia (anonimizadas) para validar resultados del motor? | No existen; las pruebas verifican coherencia interna, no criterio comercial. | Set de operaciones revisado y aprobado por JDA. | No se valida el criterio comercial del motor antes de publicar. |
| 5 | WhatsApp | JDA | ¿Cuál es el número E.164 definitivo y la modalidad (WhatsApp Business, número personal, horario de respuesta)? | JDA confirmó el 14 de septiembre de 2026 que la cuenta Zernio “Felipe” es su número personal y se usará sólo para pruebas del agente. No se adopta todavía como número comercial público. | Confirmación explícita del número comercial definitivo y la modalidad por JDA. | La cuenta personal puede probarse desde el panel; no se publica como contacto ni se considera el canal definitivo. |
| 6 | Datos del negocio | JDA | ¿Horarios de atención, link del mapa, dominio propio y redes sociales definitivos? | Perfil con dirección y teléfono nacional demo; sin dominio propio ni redes. | Datos enviados por JDA. | Se usa el dato actual marcado como pendiente; sin dominio propio no se publica. |
| 7 | Textos legales | JDA | ¿Qué versión de política de privacidad y textos de consentimiento se usan? | Textos redactados durante el desarrollo, sin revisión legal. | Texto revisado y aprobado por JDA. | Los textos siguen marcados como no revisados; bloquea publicación pública. |
| 8 | Panel | JDA | ¿Qué personas operarán el panel y qué ID de cuenta les pertenece, confirmado por un canal conocido? | `PANEL_ALLOWED_EMAILS` y `PANEL_ALLOWED_ACCOUNT_IDS` sin cuentas reales habilitadas; una única política de administrador. El alta pública no verifica email. | Confirmación de titularidad del par cuenta/correo por JDA, fecha y responsable, conservada fuera de Git. | Nadie puede operar el panel en producción (fail-closed); nunca aprobar un ID sólo porque su email coincide. |
| 9 | Consignación (V1.1) | JDA | ¿Comisión, contrato de consignación, mecanismo de retiro de la unidad y tratamiento del precio esperado? | Capacidad implementada y aislada: sin navegación, sin sitemap, `noindex`. | Acuerdo comercial documentado por JDA. | La ruta sigue oculta; la V1 se publica sin consignación. |
| 10 | Cuenta del cliente | JDA | ¿Con qué proveedor se envían los correos de recuperación de contraseña y verificación? ¿Qué texto legal acompaña el alta de cuenta? | Cuenta implementada sin envío de correo: quien olvida la contraseña no puede recuperarla solo. Texto de consentimiento redactado durante el desarrollo. | Proveedor de correo elegido y texto revisado por JDA. | Sin recuperación de contraseña: el equipo tiene que asistir a mano a quien quede afuera. |
| 11 | Carrocería en la planilla | JDA | ¿Se agrega una columna de tipo de vehículo (auto / SUV / pick-up) a la planilla de stock? | La planilla no informa carrocería; el importador publica el tipo neutro "auto". | Columna agregada a la planilla. | El filtro por tipo de vehículo no distingue las unidades importadas. |
| 12 | Cuenta del puente de mensajería | JDA | ¿Qué plan de Zernio se mantendrá para operar WhatsApp, Instagram y Facebook? | Cuenta conectada; `ZERNIO_API_KEY` y `ZERNIO_WEBHOOK_SECRET` están cargadas en Preview y Production. El gestor, OAuth, sincronización y prueba del webhook viven en `/panel/configuracion`. | Mantener activa la cuenta y confirmar el plan contratado. | Si Zernio o una cuenta se pausa, ese canal falla cerrado y no envía. |
| 13 | Plantillas de WhatsApp | JDA | ¿Qué plantillas se aprueban ante Meta y con qué texto (coincidencia de stock, seguimiento 48 h, 30 días, reseña)? | Ninguna. Fuera de la ventana de 24 horas el sistema se niega a escribir en lugar de mandar texto libre. | Plantillas aprobadas por Meta, con su nombre e idioma. | No se puede reabrir una conversación fría: el seguimiento y los avisos de coincidencia sólo salen si el cliente escribió en las últimas 24 horas. |
| 14 | Agente por canal | JDA | Falta confirmar horario y política fuera de horario. | JDA eligió permitir OpenAI el 14 de septiembre de 2026. Cada cuenta tiene un interruptor maestro apagado por defecto. OpenAI (`OPENAI_API_KEY`) tiene prioridad y Anthropic sigue como alternativa; sin ninguna clave no se puede activar. La cuenta “Felipe” es sólo de prueba. | Una clave compatible cargada y horario/política confirmados por JDA. | Todos los canales permanecen en atención humana. |
| 15 | Referencias de tasación | JDA | ¿Con qué valores de referencia por marca, modelo y año se arma el rango preliminar de permuta, y cada cuánto se actualizan? | Motor de rango implementado y versionado; **sin referencias cargadas no estima y lo dice**. No se raspa MercadoLibre: ver riesgos en PLAN_CRM_ZERNIO.md. | Tabla de referencias entregada por JDA y cargada como tarifario de tasación versionado. | La permuta por WhatsApp responde "la tasa una persona" en lugar de dar un rango. |
| 16 | Referencia de mercado MercadoLibre | JDA | ¿Qué aplicación/cuenta tiene permiso para consultar y reutilizar comparables, bajo qué atribución y retención, para qué región y con qué muestra, dispersión, vigencia y revisor responsable? | Asistente interno implementado pero deshabilitado. Sólo admite API oficial autorizada; conserva una referencia de precios publicados para revisión y no alimenta la tasación de permuta ni el tarifario. | Confirmación escrita de permisos y política de uso, parámetros comerciales y responsable; credenciales cargadas sólo en Preview privado. | El panel informa que la fuente no está configurada y no hace consultas externas. |

## Regla de uso

Pedido de experiencia del 6 de septiembre de 2026: dashboard de cliente,
catálogo, cálculo de crédito y cotización asistida por IA. Este corte mejora
los tres accesos y las superficies existentes. Para habilitar la cotización
automática, JDA debe responder la fila 15: entregar la tabla o identificar
la fuente autorizada de valores, su vigencia y quién aprueba los rangos.
Hasta entonces se conserva la tasación preliminar con revisión humana.

- Un dato sólo pasa a "confirmado" con evidencia directa de JDA registrada en
  este archivo (fecha y medio).
- Sin confirmación, el software muestra el estado honesto (DEMO, pendiente o
  fallback) y nunca una inferencia presentada como dato real.
- Las confirmaciones se cargan por el circuito correspondiente (perfil del
  negocio en Supabase, variables del entorno, tarifarios versionados) y nunca
  como hardcode en pantallas.
