# Contacto real, accesibilidad y datos estructurados

## Objetivo

Cerrar el Hito 8 en lo que depende del código: que ningún dato de contacto
esté inventado en el markup, que el recorrido sea navegable por teclado y
lector de pantalla, y que los buscadores lean la identidad del negocio y del
stock desde la misma fuente que ve el cliente.

## Problema detectado

`PublicHeader`, `PublicFooter` y `BottomNav` traen el número de WhatsApp, el
teléfono y la dirección escritos a mano. El resto de la web ya los lee del
perfil del negocio (`businessProfile`) y degrada a `/contacto` cuando no está
configurado. Con el número hardcodeado, el panel no puede corregirlo y la
puerta de salida "Número y enlace de WhatsApp confirmados" no se puede
cumplir: la web afirmaría un contacto que nadie confirmó.

## Alcance congelado

- `getPublicProfile()` cacheado en `lib/server/public-data.ts`, única fuente
  del perfil para el shell público.
- `PublicShell` pasa a Server Component asíncrono y entrega el perfil a
  header, footer y navegación inferior.
- Sin perfil o sin WhatsApp configurado, los tres enlazan a `/contacto` y no
  muestran número, dirección ni teléfono inventados.
- Enlace "Saltar al contenido" como primer nodo enfocable, apuntando al
  `<main id="contenido">` de cada página pública.
- Estilos visibles de foco para teclado en enlaces, botones y campos.
- JSON-LD `AutoDealer` en el shell público sólo con los datos confirmados del
  perfil, y `Vehicle` + `Offer` en la ficha de vehículo con el precio real.
- `sitemap.ts` incluye las fichas de vehículos publicados; `/simulaciones` y
  `/offline` quedan fuera.

## Invariantes

- Ningún componente público escribe un teléfono, dirección o WhatsApp literal.
- El JSON-LD nunca declara disponibilidad, precio ni promoción que no venga
  del snapshot servido en esa misma página.
- Si el perfil no está cargado, no se emite JSON-LD de contacto.
- El sitemap no expone códigos de operación ni rutas internas.

## Criterios de salida

- Sin perfil configurado, ninguna superficie pública muestra un número.
- El primer tabulado de cada página pública ofrece saltar al contenido.
- La ficha de vehículo emite `Vehicle`/`Offer` con el mismo precio visible.
- Tests, lint y build en verde antes del commit.
