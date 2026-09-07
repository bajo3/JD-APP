# Referencias de mercado para tasación — corte interno

## Alcance

Este corte incorpora un asistente **interno del panel** para consultar una fuente de MercadoLibre autorizada y preparar una referencia de **precios publicados**. No es una tasación, una oferta de toma de JDA ni una cotización para el cliente. Nunca modifica ni publica un `appraisal_rule_set`: el tasador sigue cargando y publicando cada tarifario por el circuito auditado existente.

No se raspa MercadoLibre, no hay fallback HTML, proxy ni evasión de controles del proveedor. La integración sólo puede usar la API oficial después de que JDA confirme la cuenta responsable, los permisos y el uso autorizado de los datos. Sin esa configuración el endpoint responde un estado honesto y no hace tráfico de red.

## Contrato

La consulta requiere marca, modelo, versión explícita, año, kilometraje, combustible, transmisión, región y moneda. No se deducen versiones desde títulos ni se usa IA para completar atributos. Cada comparable conserva sólo el identificador externo, permalink validado, atributos vehiculares necesarios, estado de publicación, precio, moneda y fechas de observación. No se guardan datos de contacto, dirección exacta, descripción completa, fotos ni respuestas crudas del proveedor.

Una entrada incompleta devuelve `INVALID_MARKET_QUERY` (HTTP 422). Los resultados del proveedor posibles son `READY_FOR_REVIEW`, `INSUFFICIENT_DATA`, `STALE`, `PROVIDER_UNAVAILABLE` y `NOT_CONFIGURED`. Sólo el primero lleva un rango; todos declaran `requiresReview: true`, metodología, fecha de consulta, vencimiento y conteos incluidos/excluidos.

Un precio cuyo significado total no esté respaldado por el contrato del proveedor queda como `UNVERIFIED` y **no participa del cálculo**. No se mezclan ARS y USD ni se inventa una conversión. Una respuesta parcial, vencida, incompleta o insuficiente tampoco genera un rango.

## Metodología técnica

El motor filtra por atributos explícitos, publicación activa y moneda única; deduplica por ID y conserva el motivo de cada exclusión. Después aplica una regla determinista, versionada y visible: mínimo de comparables, ventana de kilometraje, descarte de extremos, mediana y cuantiles. Los valores por defecto son guardas técnicas, no reglas comerciales aprobadas; JDA debe confirmar mercado, tamaño mínimo, dispersión máxima, vigencia y responsable de revisión antes de habilitar el proveedor real.

La pantalla comunica: “Referencia de precios publicados; no acredita precios de operaciones cerradas ni el valor de toma de JDA.” Los resultados no se envían al asesor, no alimentan simulaciones y no se publican en el sitio.

## Configuración y puertas

La consulta real exige `MERCADOLIBRE_MARKET_APPRAISAL_ENABLED=true`, `MERCADOLIBRE_MARKET_USE_APPROVED=true` y `MERCADOLIBRE_ACCESS_TOKEN` sólo en el entorno protegido. La primera variable no habilita nada por sí sola: las tres deben existir. El token nunca llega al navegador ni a logs.

Antes de activar se debe registrar en [DECISIONES_JDA.md](DECISIONES_JDA.md):

1. aplicación/cuenta responsable y permisos comprobados;
2. autorización, atribución y retención permitidas por MercadoLibre;
3. mercado geográfico, variantes, muestra, dispersión y vigencia;
4. responsable humano de la revisión y separación entre aviso publicado y valor de toma;
5. política cambiaria, si alguna vez se requiere.

La verificación de esta vertical incluye pruebas de filtros, moneda, extremos, duplicados, precio no verificable, respuestas parciales, 401/403/429/5xx, autorización previa y la interfaz. La prueba contra MercadoLibre real queda pendiente hasta contar con permisos expresos y se hará únicamente en un preview privado de Vercel.
