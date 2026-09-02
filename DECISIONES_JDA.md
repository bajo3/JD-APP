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
| 1 | Fuente de stock | JDA | ¿De dónde sale el stock real (sistema con exportación, planilla, carga manual) y con qué frescura en minutos? | Catálogo DEMO con `stockFreshnessMinutes` configurable (1440 por defecto). | Respuesta escrita (mensaje o mail) con la fuente y el número de minutos. | `/stock` sigue marcado DEMO; no se publica como inventario real. |
| 2 | Stock y fotos iniciales | JDA | ¿Qué unidades y fotos reales se cargan para el lanzamiento? | Ninguna unidad real; fixtures DEMO marcados como tales. | Lista de unidades con fotos entregada por JDA. | El catálogo de la candidata queda en DEMO. |
| 3 | Financiación | JDA | ¿Qué financieras, tasas, gastos, plazos y vigencias se muestran? ¿Se publican tramos reales? | Tarifario DEMO versionado, marcado ficticio en cada pantalla; el motor rechaza operar sin tarifario vigente. | Tarifario real con vigencias firmado o enviado por JDA. | La simulación sigue advirtiendo que usa tarifario DEMO. |
| 4 | Casos dorados | JDA | ¿Cuáles son al menos cinco operaciones reales de referencia (anonimizadas) para validar resultados del motor? | No existen; las pruebas verifican coherencia interna, no criterio comercial. | Set de operaciones revisado y aprobado por JDA. | No se valida el criterio comercial del motor antes de publicar. |
| 5 | WhatsApp | JDA | ¿Cuál es el número E.164 definitivo y la modalidad (WhatsApp Business, número personal, horario de respuesta)? | Sin número: `whatsapp_e164` retirado (0009); toda superficie cae a `/contacto`. El número +5492494587046 cargado antes quedó retirado por falta de confirmación. | Confirmación explícita del número y la modalidad por JDA. | No hay handoff a WhatsApp: el lead queda en el panel para ser trabajado. |
| 6 | Datos del negocio | JDA | ¿Horarios de atención, link del mapa, dominio propio y redes sociales definitivos? | Perfil con dirección y teléfono nacional demo; sin dominio propio ni redes. | Datos enviados por JDA. | Se usa el dato actual marcado como pendiente; sin dominio propio no se publica. |
| 7 | Textos legales | JDA | ¿Qué versión de política de privacidad y textos de consentimiento se usan? | Textos redactados durante el desarrollo, sin revisión legal. | Texto revisado y aprobado por JDA. | Los textos siguen marcados como no revisados; bloquea publicación pública. |
| 8 | Panel | JDA | ¿Qué correos integran la allowlist y qué responsabilidad tiene cada uno (administrar stock, tasaciones, ofertas)? | `PANEL_ALLOWED_EMAILS` sin cuentas reales configuradas; una única allowlist de administradores. | Lista de correos y roles acordada con JDA. | Nadie puede operar el panel en producción (fail-closed). |
| 9 | Consignación (V1.1) | JDA | ¿Comisión, contrato de consignación, mecanismo de retiro de la unidad y tratamiento del precio esperado? | Capacidad implementada y aislada: sin navegación, sin sitemap, `noindex`. | Acuerdo comercial documentado por JDA. | La ruta sigue oculta; la V1 se publica sin consignación. |
| 10 | Cuenta del cliente | JDA | ¿Con qué proveedor se envían los correos de recuperación de contraseña y verificación? ¿Qué texto legal acompaña el alta de cuenta? | Cuenta implementada sin envío de correo: quien olvida la contraseña no puede recuperarla solo. Texto de consentimiento redactado durante el desarrollo. | Proveedor de correo elegido y texto revisado por JDA. | Sin recuperación de contraseña: el equipo tiene que asistir a mano a quien quede afuera. |
| 11 | Carrocería en la planilla | JDA | ¿Se agrega una columna de tipo de vehículo (auto / SUV / pick-up) a la planilla de stock? | La planilla no informa carrocería; el importador publica el tipo neutro "auto". | Columna agregada a la planilla. | El filtro por tipo de vehículo no distingue las unidades importadas. |

## Regla de uso

- Un dato sólo pasa a "confirmado" con evidencia directa de JDA registrada en
  este archivo (fecha y medio).
- Sin confirmación, el software muestra el estado honesto (DEMO, pendiente o
  fallback) y nunca una inferencia presentada como dato real.
- Las confirmaciones se cargan por el circuito correspondiente (perfil del
  negocio en D1, variables del entorno, tarifarios versionados) y nunca como
  hardcode en pantallas.
