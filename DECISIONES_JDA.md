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
| 1 | Fuente de stock | JDA | El importador (`npm run stock:sync`) ya cruza la planilla, Supabase (schema `jda`, del proyecto JD-Auto) y las fotos de JD-Auto. Falta confirmar: ¿esa es la fuente definitiva, y con qué cadencia corre (a demanda o programada) y umbral de frescura en minutos? | Importador funcionando contra las tres fuentes reales de JD-Auto; `stockFreshnessMinutes` configurable (1440 por defecto); la sincronización hoy es manual, no programada. | Respuesta escrita confirmando JD-Auto como fuente definitiva, el número de minutos y si se programa. | El 5 de septiembre de 2026 se re-corrió `npm run stock:sync -- --confirm-remote` contra la Supabase nueva (la corrida del 3 de septiembre había quedado sólo en la D1 vieja): hoy la base y Supabase Storage tienen las 10 unidades reales y sus 120 fotos. Sin confirmación de JDA sigue sin publicarse como inventario oficial ni automatizarse la corrida. |
| 2 | Stock y fotos iniciales | JDA | ¿Qué unidades y fotos reales se cargan para el lanzamiento? | Diez unidades reales con 12 fotos cada una, sincronizadas desde JD-Auto el 3 de septiembre de 2026 y re-sincronizadas contra la Supabase nueva el 5 de septiembre (Fiat Cronos, Fiorino, Honda CRV, Jeep Wrangler, Mercedes CLA, Ram Laramie, Renault Fluence y Kangoo, Toyota Hilux, VW Amarok). Cuarenta y siete unidades de la planilla quedaron afuera por no tener ficha en JD-Auto o datos incompletos. | Confirmación de que esas diez son las que se muestran, o una lista distinta. | El catálogo tiene datos reales pero sin confirmar como el surtido de lanzamiento. |
| 3 | Financiación | JDA | ¿Qué financieras, tasas, gastos, plazos y vigencias se muestran? ¿Se publican tramos reales? | Tarifario DEMO versionado, marcado ficticio en cada pantalla; el motor rechaza operar sin tarifario vigente. | Tarifario real con vigencias firmado o enviado por JDA. | La simulación sigue advirtiendo que usa tarifario DEMO. |
| 4 | Casos dorados | JDA | ¿Cuáles son al menos cinco operaciones reales de referencia (anonimizadas) para validar resultados del motor? | No existen; las pruebas verifican coherencia interna, no criterio comercial. | Set de operaciones revisado y aprobado por JDA. | No se valida el criterio comercial del motor antes de publicar. |
| 5 | WhatsApp | JDA | ¿Cuál es el número E.164 definitivo y la modalidad (WhatsApp Business, número personal, horario de respuesta)? | Sin número: `whatsapp_e164` retirado (0009); toda superficie cae a `/contacto`. El número +5492494587046 cargado antes quedó retirado por falta de confirmación. | Confirmación explícita del número y la modalidad por JDA. | No hay handoff a WhatsApp: el lead queda en el panel para ser trabajado. |
| 6 | Datos del negocio | JDA | ¿Horarios de atención, link del mapa, dominio propio y redes sociales definitivos? | Perfil con dirección y teléfono nacional demo; sin dominio propio ni redes. | Datos enviados por JDA. | Se usa el dato actual marcado como pendiente; sin dominio propio no se publica. |
| 7 | Textos legales | JDA | ¿Qué versión de política de privacidad y textos de consentimiento se usan? | Textos redactados durante el desarrollo, sin revisión legal. | Texto revisado y aprobado por JDA. | Los textos siguen marcados como no revisados; bloquea publicación pública. |
| 8 | Panel | JDA | ¿Qué personas operarán el panel y qué ID de cuenta les pertenece, confirmado por un canal conocido? | `PANEL_ALLOWED_EMAILS` y `PANEL_ALLOWED_ACCOUNT_IDS` sin cuentas reales habilitadas; una única política de administrador. El alta pública no verifica email. | Confirmación de titularidad del par cuenta/correo por JDA, fecha y responsable, conservada fuera de Git. | Nadie puede operar el panel en producción (fail-closed); nunca aprobar un ID sólo porque su email coincide. |
| 9 | Consignación (V1.1) | JDA | ¿Comisión, contrato de consignación, mecanismo de retiro de la unidad y tratamiento del precio esperado? | Capacidad implementada y aislada: sin navegación, sin sitemap, `noindex`. | Acuerdo comercial documentado por JDA. | La ruta sigue oculta; la V1 se publica sin consignación. |
| 10 | Cuenta del cliente | JDA | ¿Con qué proveedor se envían los correos de recuperación de contraseña y verificación? ¿Qué texto legal acompaña el alta de cuenta? | Cuenta implementada sin envío de correo: quien olvida la contraseña no puede recuperarla solo. Texto de consentimiento redactado durante el desarrollo. | Proveedor de correo elegido y texto revisado por JDA. | Sin recuperación de contraseña: el equipo tiene que asistir a mano a quien quede afuera. |
| 11 | Carrocería en la planilla | JDA | ¿Se agrega una columna de tipo de vehículo (auto / SUV / pick-up) a la planilla de stock? | La planilla no informa carrocería; el importador publica el tipo neutro "auto". | Columna agregada a la planilla. | El filtro por tipo de vehículo no distingue las unidades importadas. |
| 12 | Cuenta del puente de mensajería | JDA | ¿Quién contrata la cuenta de Zernio, con qué plan, y qué cuentas se conectan (WhatsApp, Instagram, Facebook)? | Puente implementado; hoy no hay ninguna cuenta conectada y sin `ZERNIO_WEBHOOK_SECRET` el endpoint no acepta eventos. | Cuenta creada con al menos una cuenta conectada y las claves cargadas en el entorno. | No entra ni sale ningún mensaje: el CRM unificado queda sin canales. |
| 13 | Plantillas de WhatsApp | JDA | ¿Qué plantillas se aprueban ante Meta y con qué texto (coincidencia de stock, seguimiento 48 h, 30 días, reseña)? | Ninguna. Fuera de la ventana de 24 horas el sistema se niega a escribir en lugar de mandar texto libre. | Plantillas aprobadas por Meta, con su nombre e idioma. | No se puede reabrir una conversación fría: el seguimiento y los avisos de coincidencia sólo salen si el cliente escribió en las últimas 24 horas. |
| 14 | Asesor por WhatsApp | JDA | ¿El asesor puede escribirle solo al cliente o siempre revisa una persona al principio? ¿En qué horario atiende y qué pasa fuera de horario? | Las conversaciones nacen en atención humana: el asesor sólo contesta las que el equipo habilita, una por una. | Criterio escrito por JDA. | El asesor queda como asistente del equipo y no responde solo. |
| 15 | Referencias de tasación | JDA | ¿Con qué valores de referencia por marca, modelo y año se arma el rango preliminar de permuta, y cada cuánto se actualizan? | Motor de rango implementado y versionado; **sin referencias cargadas no estima y lo dice**. No se raspa MercadoLibre: ver riesgos en PLAN_CRM_ZERNIO.md. | Tabla de referencias entregada por JDA y cargada como tarifario de tasación versionado. | La permuta por WhatsApp responde "la tasa una persona" en lugar de dar un rango. |

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
